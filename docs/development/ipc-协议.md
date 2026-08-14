# IPC/RPC 协议（定稿）

分工总原则：**RPC = 请求/响应；ZeroMQ PUB/SUB = 单向广播事件流；journal = 持久文件沙盒**。

进程间通道分三条，按内容选：

1. **output hub（evt，实时，内存产物）**
   - 事件内存产生、即时分发；**默认瞬态、按需落盘**（显式标记 persist 才写 journal）；未落盘仅订阅者可见、不重放。
   - **事件域区分**（见 PRD `output-投影层`）：`OutputEvent` = 持久化事件（journal 重建事实源，含完整 tool-call args/result）；`ProjectedEvent` = 事件流投影（hub 广播形态，工具调用以 `tool-recorded.started/recorded` 替代完整 request/response）。`OutputEvent` 可映射到 `ProjectedEvent`（投影层，工具可经 `ToolDef.preview` 定制投影内容），反向不可逆。
   - 仅 ui handle 消费；每 conversation 一个 hub，UI 聚焦哪个订阅哪个。
   - 承载：**ZeroMQ PUB/SUB**——每 conversation 一个地址 `ipc://conversation-<conversationId>-events`（topic `conversation.output`，约定见 `core/src/event/topics.ts`）；main 订阅后经 rpc 通知 renderer（同 novel.changed 模式）。
   - slow joiner 注意：SUB 连接/订阅完成前 PUB 发的消息会错过，消费端需重查兜底。
   - ⏳ 接线：topic/地址契约已定稿；Conversation 现役 `subscribeEvents` 仍走 kkrpc 回调（remote-refs proxy），待迁移 ZeroMQ。
2. **journal 沙盒（持久，落盘子集）**
   - 落盘事件（persist=true 子集）：user/assistant.message、tool-call-request/response，及 run-start/end、compacted、clear、retry-request 等边界事件。
   - 任何 Node 进程本地可读（tail 到完整行）；renderer 经 Main 代读。查询/历史/恢复只能覆盖落盘子集。
   - **读取接口两个**：`history` 返回完整 `OutputEvent`（重建/内部用）；`projectedHistory` 返回 `ProjectedEvent`（读 journal 后过投影层重建，与 hub 实时流同形态）。
   - todo/run 状态读模型、不进事件（⏳ 现 todo 为 InMemoryConversationTodoStore，sqlite 读模型待接）。
3. **rpc（消息与控制）**
   - 用户输入、控制指令、inter-conversation 消息（经 ConversationManagerServer 调度）、wait 请求（审批/提问/退出 compose，经 CMS 队列路由；desktop 通知 renderer 决策，teammate 场景转发 parent）、审批/提问应答、novel 查询/变更。
   - 请求带 id，响应带 ok/result/error（远程失败归一 `RPCError`，带 code）。

约定：output 是内存产物、按需落盘，未落盘仅订阅者可见；进度走读不走推；manager 只管生命周期 + 消息调度。
实现：rpc 半边基于 **kkrpc**（stdio / Electron IPC / WS）；novel.changed 与 conversation 输出事件走 ZeroMQ PUB/SUB。

**transport 约束（踩坑记录）**：
- **stdio 仅限父子派生主通道**：kkrpc stdio transport 已验证可靠；stdout 必须是纯协议通道，日志走 stderr/文件。现役 desktop 中 conversation ↔ CMS 走 **manager WS**（单连接双工），stdio 仅 smoke 脚本使用。
- **禁止用附加 fd（fd>2 的 pipe）承载 rpc**：Windows 下该管道的子进程→父进程写方向在进程启动数秒后失效（fs.WriteStream / net.Socket 均复现：写入返回成功但数据永不到达，rpc 30s 超时）。conversation ↔ novel-db 这类非父子通道走 **kkrpc/ws（localhost WebSocket + token）**。
- 跨进程不存在通用流式通道：provider stream 是进程内 provider→loop 的流；单向广播事件（novel.changed / conversation 输出）走 ZeroMQ PUB/SUB；novel 查询/变更就是普通 rpc 请求/响应。
