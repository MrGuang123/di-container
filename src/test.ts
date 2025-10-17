export type Token<T = any> = symbol | string | (new (...args: any[]) => T)
export enum Scope {
  Singleton = 'Singleton',
  Transient = 'Transient'
}
export interface BaseProvider<T> {
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
export type Provider<T = any> = ClassProvider<T> | ValueProvider<T> | FactoryProvider<T>;
export interface OnInit {
  onInit(): void | Promise<void>;
}

export class ResolutionError extends Error {}
export class CircularDependencyError extends Error {}
export class ProviderNotFoundError extends Error {}

const propertyInjections: WeakMap<Function, Array<{ key: string | symbol, token: Token }>> = new WeakMap();

export function Inject(token: Token): PropertyDecorator {
  return (target: Object, propertyKey: string | symbol) => {
    const ctor = (target as any).constructor;
    const list = propertyInjections.get(ctor) ?? []
    list.push({ key: propertyKey, token })
    propertyInjections.set(ctor, list)
  }
}

function tokenToString(t: Token): string {
  if(typeof t === 'string') return t;
  if(typeof t === 'symbol') return t.description ?? t.toString();
  return (t as any)?.name ?? '[AnonymousClass'
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

export class Container {
  private providers = new Map<Token, Provider>();
  private singletons = new Map<Token, any>();
  private parent?: Container;
  constructor(parent?: Container) {
    this.parent = parent;
  }

  setProvider(p: Provider) {
    if(!p || !p.token) {
      throw new ResolutionError('Invalid provider: missing token')
    }
    this.providers.set(p.token, p)
  }

  getProvider(token: Token): Provider | undefined {
    if(this.providers.has(token)) {
      return this.providers.get(token)
    }
    return this.parent?.getProvider(token)
  }

  register(...providers: Provider[]) {
    providers.forEach(p => this.setProvider(p))
    return this;
  }

  createChild(): Container {
    return new Container(this);
  }

  private instantiate(provider: Provider, stack: Token[]): any {
    if(isClassProvider(provider)) {
      const Ctor = provider.useClass;
      const deps: Token[] = (Ctor as any).inject ?? []
      const args = deps.map(dep => this.resolve(dep, stack))
      return new Ctor(...args);
    }
    if(isValueProvider(provider)) {
      return provider.useValue;
    }
    if(isFactoryProvider(provider)) {
      const deps = provider.deps ?? []
      const args = deps.map(dep => this.resolve(dep, stack))
      return provider.useFactory(...args)
    }
  }

  private applyPropertyInjections(instance: any) {
    if(!instance || typeof instance !== 'object') return;
    const ctor = instance.constructor;
    const list = propertyInjections.get(ctor) ?? [];
    for(const { key, token } of list) {
      Object.defineProperty(instance, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: this.resolve(token)
      })
    }
  }

  resolve<T>(token: Token<T>, _stack: Token[] = []): T {
    if(_stack.includes(token)) {
      const path = [..._stack, token].map(t => tokenToString(t)).join(' -> ')
      throw new CircularDependencyError(`Circular dependency detected: ${path}`)
    }

    const provider = this.getProvider(token);
    if(!provider) {
      throw new ProviderNotFoundError(`No provider for token: ${tokenToString(token)}`)
    }

    const scope = provider.scope ?? Scope.Singleton;
    if(scope === Scope.Singleton && this.singletons.has(provider.token)) {
      return this.singletons.get(token)
    }

    const instance = this.instantiate(provider, [..._stack, token])
    this.applyPropertyInjections(instance)

    if(typeof (instance as any)?.onInit === 'function') {
      (instance as any).onInit()
    }

    if(scope === Scope.Singleton) {
      this.singletons.set(provider.token, instance)
    }

    return instance as T;
  }
}

export class ContainerModule {
  constructor(private readonly loaders: Array<(c: Container) => void>){}
  load(container: Container) {
    this.loaders.forEach(fn => fn(container))
  }
}