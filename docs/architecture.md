# Novel Harness 架构（工作文档）

> 状态标记：✅ 已定稿 · ⏳ 待敲定
> 本文件随架构演进更新。阶段目标：从上层接口向下逐步敲定，落定一层、冻结一层。

---

## 1. 概念模型（✅）

| 概念 | 定义 |
|---|---|
| **Conversation** | 持久化容器 + **进程单位**：`id` + `storedir` + 一份持久化（sqlite + 目录 + JSONL）。**1 conversation = 1 进程** |
| **Agent** | 身份/角色/能力绑定，绑到 conversation 上 |
| **Agent loop** | 一次执行：收 mailbox、发 output bus、跑 turns。进程内可 1..N 个 |
| **subagent** | **同一 conversation 进程内**派生的轻量子代理：自己的 mailbox + output bus（内存态），共享本 conversation 的 journal（按 agentId 标记），**无独立进程/持久化** |
| **teammate agent** | **新的 conversation 进程**：独立 id / storedir / 持久化 / 生命周期，由 ConversationManagerServer 统一管理 |
| **Peer** | 进程交互的对端（manager / ui / novel），经注入的通道访问 |
| **ConversationManagerServer** | 统一管理 conversation 的进程：**生命周期 + 消息调度**，不碰进度/事件 |

要点：
- **agent ≠ agent loop ≠ conversation ≠ process**，四者解耦。
- **subagent 进程内、teammate 新进程**——派生方式二分，subagent 轻、teammate 完整。
- 持久化沙盒 = 状态的事实来源：**进度读沙盒、流式走 hub、消息走 rpc**（见第 3 节）。
- 1 conversation = 1 进程 = 主 agent loop + 任意个 subagent loop；teammate 之间无直接通道，交互经 manager 调度。

---

## 2. 进程拓扑（✅）

```
┌───────────────────────────────────────────────┐
│  Electron Renderer (UI)                       │
│  ·经 IPC 交互 ·经 Main 代读沙盒（进度/历史）      │
└───────┬───────────────────────────┬───────────┘
        │ Electron IPC              │ Main 代读沙盒
┌───────▼───────────────────────────▼───────────┐
│  Electron Main = Zygote（编排/凭据/桥接）        │
│  ·派生 novel-db / manager 守护进程               │
│  ·凭据持有（不进 child/renderer）                │
└───┬─────────────────┬─────────────────────────┘
    │                 │
┌───▼───────────┐  ┌───▼──────────────────────────┐
│ novel-db 守护   │  │ ConversationManagerServer    │
│ ·canonical 数据 │  │ ·catalog + id 分配（层级规则） │
│ ·变更广播        │  │ ·spawn / terminate / 恢复     │
└───────────────┘  │ ·消息调度（inter-conversation）│
                   └──┬──────────────┬────────────┘
                      │              │ 统一 peer
            ┌─────────▼──────┐  ┌───▼───────────────┐
            │ Conversation ①  │  │ Conversation ②     │
            │ peers:          │  │ (root / teammate) │
            │  manager / ui / │  │  同构，构造一致      │
            │  novel          │  │                   │
            │  └ subagent 进程内│  │                   │
            └────────────────┘  └───────────────────┘
```

各进程职责：
- **novel-db 守护进程**：唯一 canonical 小说数据源。各进程经 WS 直连（全双工），变更广播（novel.changed）。
- **ConversationManagerServer**：**conversation 的派生父进程（stdio 父子）**；conversation 目录（id/name/storeDir/status）+ id 分配 + spawn/terminate/崩溃恢复 + **消息调度**（sendMessageTo / send*RequestTo 转发）。不持有小说数据，不路由进度/事件。
- **Zygote（Electron Main）**：派生 novel-db / manager 守护进程；凭据持有；renderer 桥接；**为 renderer 代读沙盒**。
- **Conversation 进程**（root 或 teammate，同构）：统一 peer `{ manager, ui, novel }`；持久化沙盒自持；subagent 进程内派生。
- **subagent**：进程内 loop，无 peer、无独立持久化。

边界原则：
1. 凭据只进 Main；
2. conversation 跑在独立子进程，进程内所有 loop（含 subagent）全部异步；
3. novel-db 是唯一 canonical 小说数据源，其余走 RPC + 变更订阅。

---

## 3. 通信协议：三条通道（✅）

进程间按内容选通道，互不混用：

```
① output hub（evt，实时，**内存产物**）
   · 事件在内存中产生、即时分发；**默认瞬态**，仅订阅者可见
   · 仅 ui handle 消费；每 conversation 一个 hub，UI 聚焦哪个订阅哪个
   · **按需落盘**：需持久/可查/可恢复的事件显式标记（完整消息/todo 等）

② journal 沙盒（持久，**落盘子集**）
   · 只记"按需落盘"的子集：user/assistant 消息 / tool-call-request / tool-call-response
   · 任何 Node 进程本地可读（tail 到完整行）；renderer 经 Main 代读
   · 已落盘内容的查询 / 历史 / 恢复的事实来源；**未落盘事件不存在于任何持久层**

③ rpc（消息与控制）
   · 用户输入、控制指令、inter-conversation 消息（经 manager 调度）
   · wait 请求（审批/提问/退出 compose）经 manager 转发到 parent，由 parent 逻辑决定下一步
   · wait 决策 = 延迟 RPC 返回值（阻塞到答案）、novel 查询/变更
   · 请求带 id，响应带 ok/result/error
```

约定：
- **output 是内存产物，按需落盘**：大部分实时事件只有订阅者能看到；未落盘即不可查、不重放；恢复只能恢复到落盘子集。
- **落盘策略**：事件显式标记 persistent（消息流四类），默认瞬态；todo/run 状态在 sqlite 读模型，不进事件。
- **进度走读不走推**：parent 看 teammate 进度 = 读 teammate 沙盒（只能看到已落盘子集）；manager 不碰进度/事件。
- **manager 只做生命周期 + 消息调度**（inter-conversation 控制消息 + wait 请求排队/路由），不做 event hub。
- novel.changed 仍推送（数据变更通知，不属于 conversation 沙盒）。
- 实现：rpc 半边基于 **kkrpc**（stdio / Electron / WS）。**hub 承载已定**：kkrpc async iterable streaming（`events(fromSeq)`，credit 背压，`break` 取消）；delta 直接走背压，**chunk 聚合暂缓**。

各边 transport：

| 边 | transport |
|---|---|
| manager ↔ conversation（父子派生） | stdio（`nodeStdioTransport`），**stdout 保持纯净**，日志走 stderr/文件 |
| zygote ↔ manager / novel-db（派生守护进程） | stdio（父子派生） |
| conversation ↔ novel-db（非父子） | WebSocket（`kkrpc/ws`）+ token（kkrpc 无裸 TCP transport） |
| conversation ↔ UI | 经 Main 桥接（Electron IPC） |
| renderer ↔ Main | Electron IPC（`kkrpc/electron`） |

rpc 语义补充：
- **输入类 rpc 的响应是"持久化回执（journal seq）"，不是处理结果**：落 journal 即回 ack，处理异步进行，产物走 ②/①。禁止同步等完整结果。
- 远程调用失败（对端挂/超时/远端抛错）经 handle 归一为带 `code` 的 `RPCError`。

---

## 4. 进程入口与对端注入（✅）

所有 conversation 进程启动入口统一在 `ConversationInit.run()`，对端用**依赖注入**传入，接线放进程 bootstrap。

```ts
// core/src/init/ConversationInit.ts
export interface ConversationPeers {
  manager: Transport   // 生命周期 + inter-conversation 消息调度
  ui: Transport        // 输入 rpc + output hub（live stream）
  novel: Transport     // 单工调用 novel（client-only）
}

export interface ConversationEnv {
  conversationId: string
  agentId: string
  storedir: string     // ← manager 分配
  parentId?: string    // teammate 才有（catalog 记录），不产生通道差异
}

export async function run(peers: ConversationPeers, env: ConversationEnv): Promise<void> {
  const conversation = new Conversation(env, {
    manager: new RPCChannel<ConvAPI, ManagerAPI>(peers.manager, { expose: convAPI }),
    ui:      new RPCChannel<ConvAPI, UIAPI>(peers.ui, { expose: convAPI }),
    novel:   wrap<NovelAPI>(peers.novel),   // client-only：不 expose 给 novel
  })
  await conversation.start()
}
```

- **所有 conversation 构造一致**：root 与 teammate 同构，peer 集统一 `{ manager, ui, novel }`，无角色分支。角色差异（root/teammate、parentId）只进 catalog，不进通道。
- **subagent 无 peers**：进程内派生，`loop.spawnSubagent({ agentType, task })`。
- bootstrap 只接线：manager/ui/novel 的 transport 从 env 构造（token 随 spawn 注入）；测试注入 memory transport 即可单测。

---

## 5. ID 与持久化（✅）

### 5.1 conversationId：ConversationManagerServer 分配

- **层级规则由 manager 执行**：root = uuid；teammate = `<parentId>:<seq>`，全局唯一由构造保证。
- manager 持有 catalog（id/name/storeDir/status），UI 列表查 manager。
- 无中心 id 服务之外的耦合：id 只需全局唯一 + 跨重启稳定，无需全局可查（对端是通道，不是 id 寻址）。

### 5.2 持久化：每 conversation = sqlite + 目录 + JSONL（事件溯源）

```
storedir/<conversationId>/
  ├─ journal.jsonl   ← 事实来源：按需落盘的消息级事件子集，追加 + 序列号（默认瞬态，显式标记才写）
  ├─ conversation.db ← 物化读模型：当前消息/meta/mode/todo/投影，可事务、可外部只读
  └─ (projection/)   ← 渲染投影，可由 journal 重建，非权威
```

- **ConversationPersistenceService**（每进程一个实例）统一管理本 conversation 的持久化。
- **写者唯一**：每个 journal 只有拥有它的进程写。进程内对同一 journal 的写入**串行化**——单写者 journal writer 队列（同步 push + 单一 drainer 追加），保顺序与不交错。
- **compaction**：journal 支持全量覆盖写 `write(evts)`，压缩后重写整表。
- **多读者安全**：append-only + 每行一次原子写，任何 Node 进程可本地 tail（到最后一个完整行）；renderer 经 Main 代读。恢复/重放容忍末尾半行。
- **崩溃恢复**：manager 用同一 storedir 重新派生 → 读 journal → 重放 → 重建 sqlite → 对账续跑。停止期生成失败一律按优雅中止处理（避开旧 host_close 死锁）。

---

## 6. Handle 门面（✅）

每个对端一个 handle 类，封装远程调用；业务代码不直接碰 kkrpc。handle 方法内部统一 `call()`：远程失败归一为带 `code` 的 `RPCError`；`withCallOptions()`（超时/AbortSignal）封装于此。

| handle | 持有方 | 内容 |
|---|---|---|
| **manager handle** | conversation | register/heartbeat/status、`sendMessageTo`（投递 user/command/control）、wait 转发（`send*RequestTo`，阻塞到决策）、`spawnConversation`（agentType/version/extraPrompt）、terminate |
| **ui handle** | conversation | 输入（sendUserMessage 等入）+ output hub（live stream 出） |
| **novel handle** | conversation | `query` / `mutate`（单工，client-only） |
| **conversation handle** | UI（经 Main） | 对某 conversation 的视图：输入（含 `sendSystemControl` 应答审批）+ hub 订阅 |
| **subagent handle** | 主 loop（进程内） | `send(指令)` / `events()` / `result()` / `stop()` |

- handle 集合**全 conversation 统一**（无 parent 通道）；subagent 无跨进程 handle。
- 换 transport（stdio ↔ memory ↔ ws）只改 handle 构造，业务零改动。
- 关键边界：**parent 与 teammate 无直连**，inter-conversation 消息一律经 manager handle `sendTo` 调度；进度一律读沙盒。

---

## 7. 接口层（⏳ 待敲定 —— 当前阶段目标）

从上层向下逐层敲定。目前定稿形状：

```ts
// contract/interaction.ts
interface ConversationInteraction {
  sendUserMessage(msg: ConversationUserMessage): Promise<Receipt>
  sendUserCommand(cmd: ConversationUserCommand): Promise<Receipt>
  sendSystemControl(ctrl: ConversationSystemControl): Promise<Receipt>
}

/** 等待交互接收接口：conversation 实现，接收经 manager 转发来的 wait 请求 */
interface WaitingInteractionRequest {
  sendApprovalRequest(req: ConversationApprovalRequest): Promise<Receipt>
  sendAskingQuestionRequest(req: ConversationAskingRequest): Promise<Receipt>
  sendExitComposeRequest(req: ConversationExitComposeRequest): Promise<Receipt>
}
```

- **两个接口有区分**：`ConversationManagerServer.send*RequestTo` 是**转发接口**（发送方经 cms 转发，cms 查图后调目标 conversation 的 `WaitingInteractionRequest` 投递）；`WaitingInteractionRequest` 是**会话侧接收接口**（conversation 实现它接收 wait 请求）。
- **wait 请求是方法调用，不是 journal 事件**：`approval.request` / `question` 事件已从 OutputEvent 删除。
- **wait 是延迟 RPC（阻塞）**：`await sendApprovalRequest(req)` 挂起该 turn，直到决策/回答产生才 resolve；**决策/回答就是 RPC 返回值**，requestId = RPC 关联 id，不走 sendSystemControl。
- **wait RPC 实现约束**：**无/超长超时**（审批可等几分钟，`withCallOptions` 设无限超时）；**进程死亡解挂**——终端应答方进程死亡时，整条链的 pending wait RPC 需 resolve 成错误，解挂所有 await 的 turn 并走优雅中止（handle 层负责）。
- **history 不经 manager**：UI 经 `ConversationJournalReadOnlyService` 直接查。
- **拆分已定**：`sendUserCommand`（turn lane，agent 可见）与 `sendSystemControl`（control lane，可抢占）分开；`sendSystemControl` = `stop` / `reload.config`。
- subagent 的审批：进程内由主 loop 决定；teammate 的审批路径：**经 manager 转发到 parent**（已定）。

---

## 8. 待定决策清单（⏳）

1. **delta chunk 聚合**：暂缓——目前 delta 直走 kkrpc 背压，聚合 chunk 后续再评估。
2. **sqlite 驱动**：better-sqlite3（同步，短查询可接受）vs worker 封装（严格不阻塞）。
3. **接口层最终形态**（见第 7 节）。
4. **实现顺序**：wire 协议（kkrpc 接入）→ conversation 持久化核心（journal+sqlite+replay）→ mailbox + output bus → AgentLoop 跑在 provider 上 → manager / novel-db 进程 + socket → subagent / teammate 递归。
