// di.ts — 一个可在面试中“默写”的通用DI容器（无第三方依赖）
// 设计目标：
// 1) 支持三种Provider：Class / Value / Factory
// 2) 支持作用域：Singleton、Transient；支持子容器（Scoped）
// 3) 支持构造器注入（静态 inject 数组声明依赖）与属性注入（@Inject 装饰器）
// 4) 支持模块化注册（ContainerModule）
// 5) 支持循环依赖检测
// 6) 支持生命周期 onInit()
// 7) 纯TypeScript，易于在JS中改写；无 reflect-metadata 依赖

// •	循环依赖：resolve() 维护解析栈 _stack，如遇已在栈中的 token，抛出 CircularDependencyError（带依赖链）。
// •	Provider 优先级：Class → 通过 static inject 递归 resolve；Value → 直接使用；Factory → 先解析 deps 后调用工厂。
// •	作用域：Singleton 命中 singletons 即返回；未命中则创建并放入缓存。Transient 每次新建不缓存。
// •	属性注入：@Inject(token) 的元数据在实例化后统一赋值（使用 Object.defineProperty）。
// •	子容器：getProvider 先查自己，再向上委托；单例缓存不共享（根与子各自维护）。
// •	生命周期：若存在 onInit()，在注入完成后调用一次。

/* ===================== 类型与辅助 ===================== */
// Token 是容器内部查找依赖的唯一标识，可以是 symbol/string/构造函数
export type Token<T = any> = symbol | string | (new (...args: any[]) => T);

// Scope 描述容器为某个 token 创建实例时的生命周期
export enum Scope {
  Singleton = "Singleton",
  Transient = "Transient",
}

// 所有 Provider 共享的基础字段：token + 生命周期 scope
export interface BaseProvider<T = any> {
  token: Token<T>;
  scope?: Scope;
}
// ClassProvider：通过 new class(...) 创建实例
export interface ClassProvider<T = any> extends BaseProvider<T> {
  useClass: new (...args: any[]) => T;
}
// ValueProvider：直接返回给定的值（配置对象等）
export interface ValueProvider<T = any> extends BaseProvider<T> {
  useValue: T;
}
// FactoryProvider：执行工厂函数生成实例，可声明依赖项
export interface FactoryProvider<T = any> extends BaseProvider<T> {
  useFactory: (...deps: any[]) => T;
  deps?: Token[];
}
export type Provider<T = any> = ClassProvider<T> | ValueProvider<T> | FactoryProvider<T>;

// 支持生命周期钩子：解析后会调用 onInit()
export interface OnInit {
  onInit(): void | Promise<void>;
}

// 错误类型
// ResolutionError：表示 Provider 定义或解析过程本身的问题
export class ResolutionError extends Error {}
// CircularDependencyError：检测到循环依赖时抛出
export class CircularDependencyError extends Error {}
// ProviderNotFoundError：未注册 token 时抛出
export class ProviderNotFoundError extends Error {}

/* ===================== 属性注入元数据 ===================== */
// 使用 WeakMap 保存类的属性注入声明：Ctor -> Array<{key, token}>
const propertyInjections: WeakMap<Function, Array<{ key: string | symbol; token: Token }>> = new WeakMap();

// 属性装饰器：将 token 与属性名关联，解析实例后再做赋值
export function Inject(token: Token): PropertyDecorator {
  return (target: Object, propertyKey: string | symbol) => {
    const ctor = (target as any).constructor;
    const list = propertyInjections.get(ctor) ?? [];
    list.push({ key: propertyKey, token });
    propertyInjections.set(ctor, list);
  };
}

/* ===================== 容器实现 ===================== */
// Container 负责：注册 Provider、解析依赖、维护单例缓存，以及支持层级容器
export class Container {
  // Provider 注册表：记录 token -> Provider 定义（仅当前容器）
  private providers = new Map<Token, Provider>();
  // 单例实例缓存：token -> 已创建实例（仅当前容器）
  private singletons = new Map<Token, any>();
  // 父容器引用，用于向上委托查找 Provider
  private parent?: Container;

  constructor(parent?: Container) {
    this.parent = parent;
  }

  // 注册多个或单个 Provider
  register(...providers: Provider[]) {
    providers.forEach((p) => this.setProvider(p));
    return this;
  }

  // 创建子容器（作用域隔离，继承父级Provider定义，但单例实例独立）
  createChild(): Container {
    return new Container(this);
  }

  // 解析依赖
  resolve<T>(token: Token<T>, _stack: Token[] = []): T {
    // 循环依赖检测
    if (_stack.includes(token)) {
      const path = [..._stack, token]
        .map((t) => tokenToString(t))
        .join(" -> ");
      throw new CircularDependencyError(`Circular dependency detected: ${path}`);
    }

    // 自身查找 -> 父级查找 Provider 定义
    const provider = this.getProvider(token);
    if (!provider) {
      throw new ProviderNotFoundError(`No provider for token: ${tokenToString(token)}`);
    }

    const scope = provider.scope ?? Scope.Singleton;

    // 单例缓存
    if (scope === Scope.Singleton && this.singletons.has(provider.token)) {
      return this.singletons.get(provider.token);
    }

    // 实例化当前 Provider；stack 用于记录解析路径
    const instance = this.instantiate(provider, [..._stack, token]);

    // 属性注入（装饰器声明）
    this.applyPropertyInjections(instance);

    // 生命周期钩子
    if (typeof (instance as any)?.onInit === "function") {
      (instance as any as OnInit).onInit();
    }

    if (scope === Scope.Singleton) {
      // 保存当前容器的单例实例，后续 resolve 直接复用
      this.singletons.set(provider.token, instance);
    }

    return instance as T;
  }

  /* ============== 私有方法 ============== */
  // 注册单个 Provider，校验 token 是否存在
  private setProvider(p: Provider) {
    if (!p || !p.token) {
      throw new ResolutionError("Invalid provider: missing token");
    }
    this.providers.set(p.token, p);
  }

  // 先从当前容器查找 Provider，找不到时委托给父容器
  private getProvider(token: Token): Provider | undefined {
    if (this.providers.has(token)) {
      return this.providers.get(token);
    }
    return this.parent?.getProvider(token);
  }

  private instantiate(provider: Provider, stack: Token[]): any {
    if (isClassProvider(provider)) {
      const Ctor = provider.useClass;
      // 静态 inject 数组声明构造函数依赖
      const deps: Token[] = (Ctor as any).inject ?? [];
      const args = deps.map((dep) => this.resolve(dep, stack));
      return new Ctor(...args);
    }

    if (isFactoryProvider(provider)) {
      // 工厂 Provider 按顺序解析 deps 再调用 useFactory
      const deps = provider.deps ?? [];
      const args = deps.map((dep) => this.resolve(dep, stack));
      return provider.useFactory(...args);
    }

    if (isValueProvider(provider)) {
      // Value Provider 直接返回固定值
      return provider.useValue;
    }

    throw new ResolutionError("Unknown provider type");
  }

  private applyPropertyInjections(instance: any) {
    if (!instance || typeof instance !== "object") return;
    const ctor = instance.constructor;
    // 读取在装饰器中缓存的属性注入元数据，并逐个赋值
    const list = propertyInjections.get(ctor) ?? [];
    for (const { key, token } of list) {
      Object.defineProperty(instance, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: this.resolve(token),
      });
    }
  }
}

/* ===================== 模块支持 ===================== */
// ContainerModule 用于批量注册 Provider，可组合成模块化装载
export class ContainerModule {
  constructor(private readonly loaders: Array<(c: Container) => void>) {}
  load(container: Container) {
    // 顺序执行注册函数，将 Provider 注册到传入的容器
    this.loaders.forEach((fn) => fn(container));
  }
}

/* ===================== 工具函数与类型守卫 ===================== */
// 类型守卫：根据 Provider 字段判断具体类型，方便类型缩小
function isClassProvider(p: Provider): p is ClassProvider {
  return (p as any).useClass;
}
function isValueProvider(p: Provider): p is ValueProvider {
  return (p as any).useValue !== undefined;
}
function isFactoryProvider(p: Provider): p is FactoryProvider {
  return (p as any).useFactory;
}

function tokenToString(t: Token): string {
  if (typeof t === "string") return t;
  if (typeof t === "symbol") return t.description ?? t.toString();
  // 类构造函数作为 token 时，优先使用类名
  return (t as any).name ?? "[AnonymousClass]";
}

/* ===================== 使用示例（可删） ===================== */
// 1) 定义Tokens（也可直接用类作为token）
const TOKENS = {
  Logger: Symbol("Logger"),
  Config: Symbol("Config"),
  Clock: Symbol("Clock"),
};

// 2) 定义服务
class ConsoleLogger {
  log(msg: string) {
    console.log(`[LOG] ${msg}`);
  }
}

class SystemClock {
  now() {
    return new Date();
  }
}

class Greeter implements OnInit {
  static inject = [TOKENS.Logger, TOKENS.Config, TOKENS.Clock] as const;
  constructor(
    private logger: ConsoleLogger,
    private config: { appName: string },
    private clock: SystemClock
  ) {}

  // 属性注入示例
  @Inject(TOKENS.Logger)
  private anotherLogger!: ConsoleLogger;

  onInit() {
    this.logger.log("Greeter initialized");
  }

  greet(name: string) {
    const t = this.clock.now().toISOString();
    this.anotherLogger.log(`Hello ${name} from ${this.config.appName} at ${t}`);
  }
}

// 3) 组装容器
export function buildRootContainer() {
  const root = new Container();

  const coreModule = new ContainerModule([
    (c) => c.register({
      token: TOKENS.Logger,
      useClass: ConsoleLogger,
      scope: Scope.Singleton,
    }),
    (c) =>  c.register({
      token: TOKENS.Clock,
      useClass: SystemClock,
      scope: Scope.Transient,
    }),
    (c) => c.register({
      token: TOKENS.Config,
      useValue: { appName: "MyApp" },
    }),
    (c) => c.register({
      token: Greeter,
      useClass: Greeter,
      scope: Scope.Transient,
    }),
  ]);

  coreModule.load(root);
  return root;
}

// 4) 演示：
if (require.main === module) {
  const root = buildRootContainer();
  const child = root.createChild(); // 子容器有独立的单例缓存

  const g1 = root.resolve(Greeter);
  g1.greet("Alice");

  const g2 = child.resolve(Greeter);
  g2.greet("Bob");

  // 单例验证：Logger 在各自容器内是单例
  console.log("root Logger === child Logger?", root.resolve(TOKENS.Logger) === child.resolve(TOKENS.Logger)); // false
  console.log("root Logger self-singleton?", root.resolve(TOKENS.Logger) === root.resolve(TOKENS.Logger)); // true
}
