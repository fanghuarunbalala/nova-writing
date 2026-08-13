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
2. **journal 沙盒（持久，落盘子集）**：消息流事件（user/assistant.message、tool-call-request/response）落盘；任何 Node 进程本地可读（tail 到完整行），renderer 经 Main 代读。查询/历史/恢复只能覆盖落盘子集。todo/run 状态在 sqlite 读模型，不进事件。
3. **rpc（消息与控制）**：用户输入、控制指令、inter-conversation 消息（经 ConversationManagerServer 调度）、wait 请求（审批/提问/退出 compose，经 manager 路由到 parent）、审批/提问应答、novel 查询/变更。请求带 id，响应带 ok/result/error。novel.changed 为数据变更推送。

约定：output 是内存产物、按需落盘，未落盘仅订阅者可见；进度走读不走推；manager 只管生命周期 + 消息调度。
实现：rpc 半边基于 **kkrpc**（stdio / Electron transport）。

**transport 约束（踩坑记录）**：
- **stdio 仅限父子派生主通道**（manager ↔ conversation 的 stdin/stdout 对话通道，kkrpc stdio transport 已验证可靠）。
- **禁止用附加 fd（fd>2 的 pipe）承载 rpc**：Windows 下该管道的子进程→父进程写方向在进程启动数秒后失效（fs.WriteStream / net.Socket 均复现：写入返回成功但数据永不到达，rpc 30s 超时）。conversation ↔ novel-db 这类非父子通道按 architecture.md 走 **kkrpc/ws（localhost WebSocket + token）**。
- 跨进程不存在通用流式通道：provider stream 是进程内 provider→loop 的流；output hub 实时分发经 rpc 回调推送；novel.changed 走 ZeroMQ PUB/SUB。novel 查询/变更就是普通 rpc 请求/响应。
