export type Token<T = any> = symbol | string | (new (...args: any[]) => T);

export enum Scope {
  Singleton = "Singleton",
  Transient = "Transient",
}

export interface BaseProvider<T = any> {
  token: Token<T>;
  scope?: Scope;
}

export interface ClassProvider<T = any> extends BaseProvider<T> {
  useClass: new (...args: any[]) => T;
}
export interface ValueProvider<T = any> extends BaseProvider<T> {
  useValue: T;
}
export interface FactoryProvider<T = any> extends BaseProvider<T> {
  useFactory: (...deps: any[]) => T;
  deps?: Token[];
}
export type Provider<T = any> =
  | ClassProvider<T>
  | ValueProvider<T>
  | FactoryProvider<T>;
export interface OnInit {
  onInit(): void | Promise<void>;
}

export class ResolutionError extends Error {}
export class CircularDependencyError extends Error {}
export class ProviderNotFoundError extends Error {}

const propertyInjections: WeakMap<
  Function,
  Array<{ key: string | symbol; token: Token }>
> = new WeakMap();

function tokenToString(t: Token): string {
  if (typeof t === "string") return t;
  if (typeof t === "symbol") return t.description ?? t.toString();
  return (t as any).name ?? "[AnonymousClass]";
}

function isClassProvider(p: Provider): p is ClassProvider {
  return (p as any).useClass;
}
function isValueProvider(p: Provider): p is ValueProvider {
  return (p as any).useValue !== undefined;
}
function isFactoryProvider(p: Provider): p is FactoryProvider {
  return (p as any).useFactory;
}

export function Inject(token: Token): PropertyDecorator {
  return (target: Object, propertyKey: string | symbol) => {
    const ctor = (target as any).constructor;
    const list = propertyInjections.get(ctor) ?? [];
    list.push({ key: propertyKey, token });
    propertyInjections.set(ctor, list);
  };
}

export class Container {
  private providers = new Map<Token, Provider>();
  private singletons = new Map<Token, any>();
  private parent?: Container;

  constructor(parent?: Container) {
    this.parent = parent;
  }

  private setProvider(p: Provider) {
    if (!p || !p.token) {
      throw new ResolutionError("Invalid provider: missing token");
    }
    this.providers.set(p.token, p);
  }

  private getProvider(token: Token): Provider | undefined {
    if (this.providers.has(token)) {
      return this.providers.get(token);
    }
    return this.parent?.getProvider(token);
  }

  private instantiate(provider: Provider, stack: Token[]): any {
    if (isClassProvider(provider)) {
      const Ctor = provider.useClass;
      const deps: Token[] = (Ctor as any).inject ?? [];
      const args = deps.map((dep) => this.resolve(dep, stack));
      return new Ctor(...args);
    }

    if (isFactoryProvider(provider)) {
      const deps = provider.deps ?? [];
      const args = deps.map((dep) => this.resolve(dep, stack));
      return provider.useFactory(...args);
    }

    if (isValueProvider(provider)) {
      return provider.useValue;
    }
  }

  private applyPropertyInjections(instance: any) {
    if (!instance || typeof instance !== "object") return;
    const ctor = instance.constructor;
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

  register(...providers: Provider[]) {
    providers.forEach((p) => this.setProvider(p));
    return this;
  }

  createChild(): Container {
    return new Container(this);
  }

  resolve<T>(token: Token<T>, _stack: Token[] = []): T {
    if (_stack.includes(token)) {
      const path = [..._stack, token].map((t) => tokenToString(t)).join(" -> ");
      throw new CircularDependencyError(
        `Circular dependency detected: ${path}`,
      );
    }

    const provider = this.getProvider(token);
    if (!provider) {
      throw new ProviderNotFoundError(
        `No provider for token: ${tokenToString(token)}`,
      );
    }

    const scope = provider.scope ?? Scope.Singleton;
    if (scope === Scope.Singleton && this.singletons.has(provider.token)) {
      return this.singletons.get(provider.token);
    }

    const instance = this.instantiate(provider, [..._stack, token]);
    this.applyPropertyInjections(instance);

    if (typeof (instance as any)?.onInit === "function") {
      (instance as any as OnInit).onInit();
    }

    return instance as T;
  }
}

export class ContainerModule {
  constructor(private readonly loaders: Array<(c: Container) => void>) {}
  load(container: Container) {
    this.loaders.forEach((fn) => fn(container));
  }
}

// 使用示例：
const TOKENS = {
  Logger: Symbol("Logger"),
  Config: Symbol("Config"),
  Clock: Symbol("Clock"),
};

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
    private clock: SystemClock,
  ) {}

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

export function buildRootContainer() {
  const root = new Container();

  const coreModule = new ContainerModule([
    (c) =>
      c.register({
        token: TOKENS.Logger,
        useClass: ConsoleLogger,
        scope: Scope.Singleton,
      }),
    (c) =>
      c.register({
        token: TOKENS.Clock,
        useClass: SystemClock,
        scope: Scope.Transient,
      }),
    (c) =>
      c.register({
        token: TOKENS.Config,
        useValue: { appName: "MyApp" },
      }),
    (c) =>
      c.register({
        token: Greeter,
        useClass: Greeter,
        scope: Scope.Transient,
      }),
  ]);

  coreModule.load(root);
  return root;
}

// 演示
if (require.main === module) {
  const root = buildRootContainer();
  const child = root.createChild();

  const g1 = root.resolve(Greeter);
  g1.greet("Alick");
  const g2 = root.resolve(Greeter);
  g2.greet("Bob");

  console.log(
    "root logger === child logger?",
    root.resolve(TOKENS.Logger),
    child.resolve(TOKENS.Logger),
  );
  console.log(
    "root logger self-singleton?",
    root.resolve(TOKENS.Logger),
    root.resolve(TOKENS.Logger),
  );
}

