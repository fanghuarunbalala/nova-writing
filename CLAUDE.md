# Novel Harness

网络小说辅助创作 harness。TypeScript + pnpm monorepo。

## 代码规范

1. **agent loop 一定是异步（async）**：conversation 跑在独立子进程中；进程内所有 agent loop（含 subagent）的循环主体与全部 IO 均为异步实现，禁止同步阻塞主线程。

2. **public 导出必须带统一格式注释**：
   - 所有导出的函数、方法、属性、类型都必须有注释；
   - 采用业界公用的 JSDoc 规范：正文说明该方法/属性作用，`@param` 逐条说明参数作用，`@returns` 说明返回值；
   - 全项目统一此格式。

## IPC/RPC 协议（定稿）

进程间通道分三条，按内容选：

1. **output hub（evt，实时，内存产物）**：事件内存产生、即时分发，**默认瞬态、按需落盘**（显式标记 persistent 才写 journal）；仅 ui handle 消费，每 conversation 一个 hub。**大部分实时事件只有订阅者可见，未落盘不重放**。
2. **journal 沙盒（持久，落盘子集）**：完整消息/todo/审批请求等显式标记的事件落盘；任何 Node 进程本地可读（tail 到完整行），renderer 经 Main 代读。查询/历史/恢复只能覆盖落盘子集。
3. **rpc（消息与控制）**：用户输入、控制指令、inter-conversation 消息（经 ConversationManagerServer 调度）、审批应答、novel 查询/变更。请求带 id，响应带 ok/result/error。novel.changed 为数据变更推送。

约定：output 是内存产物、按需落盘，未落盘仅订阅者可见；进度走读不走推；manager 只管生命周期 + 消息调度。
实现：rpc 半边基于 **kkrpc**（stdio / Electron transport）。
