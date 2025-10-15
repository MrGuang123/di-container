# IOC 实践项目

这是一个 TypeScript 开发环境，用于学习和实践依赖注入（IOC）模式。

## 可用脚本

- `npm run build` - 编译 TypeScript 代码到 `dist` 目录
- `npm run dev` - 开发模式，自动监听文件变化并重启
- `npm start` - 运行编译后的代码
- `npm run watch` - 监听模式，自动编译 TypeScript 代码

## TypeScript 配置说明

本项目使用了以下重要配置：

- **experimentalDecorators**: 启用装饰器支持（用于 IOC）
- **emitDecoratorMetadata**: 生成装饰器元数据
- **strict**: 启用严格模式类型检查
- **target**: ES2020
- **module**: CommonJS
