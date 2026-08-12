# Novel Harness

网络小说辅助创作 harness。TypeScript + pnpm monorepo。

## 代码规范

1. **agent loop 子进程一定是异步（async）**：agent loop 必须跑在独立子进程中，循环主体与全部 IO 均为异步实现，禁止同步阻塞主线程。

2. **public 导出必须带统一格式注释**：
   - 所有导出的函数、方法、属性、类型都必须有注释；
   - 采用业界公用的 JSDoc 规范：正文说明该方法/属性作用，`@param` 逐条说明参数作用，`@returns` 说明返回值；
   - 全项目统一此格式。
