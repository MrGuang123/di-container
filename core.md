## 核心构件

- **Token**：用于标识依赖的唯一 key，可以是 `symbol`、`string` 或构造函数；构造函数常用于“类即 Token”的写法。
- **Provider**：容器的注册单元，支持三种模式：
  - `ClassProvider`：调用 `new` 创建实例，依赖通过静态 `inject` 数组声明。
  - `ValueProvider`：将固定值（配置、常量）直接暴露给容器。
  - `FactoryProvider`：执行自定义工厂函数，`deps` 数组定义注入顺序。
- **Scope**：控制实例生命周期。`Singleton` 表示容器内单例缓存，`Transient` 表示每次解析都重新创建。
- **OnInit**：可选生命周期钩子，依赖被构建完毕后立即调用。

## 属性注入元数据

- 使用 `WeakMap` 维护“构造函数 → 待注入属性列表”的映射，确保不会阻止类被垃圾回收。
- `@Inject(token)` 装饰器只做记录，不立即赋值；真正赋值发生在容器实例化并调用 `applyPropertyInjections` 时。

## 容器职责概览

- 维护当前容器的 Provider 注册表（`providers`）和单例缓存（`singletons`）。
- 可选指向父容器，以支持层级查找与作用域隔离。
- 提供 `register`、`resolve`、`createChild`、`ContainerModule.load` 等 API。

## 解析流程（`resolve`）

1. **循环检测**：解析栈 `_stack` 记录调用链，一旦出现重复 Token 即抛出 `CircularDependencyError`。
2. **Provider 查找**：先查当前容器，找不到再向父容器委托；缺失时报 `ProviderNotFoundError`。
3. **作用域判断**：若 `scope` 为 `Singleton` 且缓存命中，直接返回缓存实例。
4. **实例化**：调用 `instantiate` 根据 Provider 类型创建实例，解析所需依赖时递归进入 `resolve`。
5. **属性注入**：读取装饰器记录的属性列表，逐个 `Object.defineProperty` 赋值。
6. **生命周期钩子**：若对象实现 `onInit`，在依赖齐备后立即执行。
7. **单例缓存**：对于 `Singleton` scope，将实例写入缓存供后续复用。

## 实例化策略（`instantiate`）

- **ClassProvider**：读取目标类的静态 `inject` 数组，按顺序解析依赖后调用 `new`.
- **FactoryProvider**：依次解析 `deps`，将结果传入 `useFactory`。
- **ValueProvider**：直接返回 `useValue`，无额外逻辑。
- 若 Provider 不匹配任意类型，抛出 `ResolutionError` 防止静默失败。

## 作用域与子容器

- `createChild()` 生成新的容器实例，共享 Provider 定义但拥有独立单例缓存。
- 典型用途：Web 请求作用域、测试隔离或多租户配置。

## 生命周期与属性注入

- 属性注入发生在构造函数执行之后，保证构造函数逻辑能访问基础依赖，而装饰器注入可用于可选或循环依赖场景。
- `onInit` 让实例在依赖完全就绪后执行初始化逻辑（例如建立连接、启动定时器）。

## 模块化注册

- `ContainerModule` 接受一组 `(container) => void` 的 loader 函数，实现批量注册与解耦。
- `load` 方法顺序执行 loader，可在不同模块中组织 Provider 注册。

## 循环依赖检测

- 解析过程中维护栈 `_stack`，在每次 `resolve` 时传入新的 Token。
- 一旦检测到重复 Token，会输出路径信息（`A -> B -> A`）帮助定位问题。

## 错误处理

- `ProviderNotFoundError`：提示未注册的 Token。
- `CircularDependencyError`：告知循环链路。
- `ResolutionError`：用于 Provider 定义不合法或未知类型。

## 示例运行流程

- `buildRootContainer` 注册 Logger、Clock、Config、Greeter 四个 Provider。
- `Greeter` 声明构造器依赖及属性注入 Logger，`onInit` 打印初始化信息。
- `root.resolve(Greeter)` 与 `child.resolve(Greeter)` 展示子容器拥有独立单例缓存。
- 日志对比验证同一容器内单例复用、子容器间单例隔离。

## 常见扩展点

- 增加 `Scoped` scope 用于请求级缓存。
- 支持基于 `async` 的工厂或生命周期钩子。
- 增强装饰器：例如记录可选依赖、默认值或注入时机。

