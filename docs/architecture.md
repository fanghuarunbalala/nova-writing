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

术语约定（全库统一，见 PRD `conversation-run-turn-术语统一`）：

| 术语 | 定义 |
|---|---|
| **run（用户轮）** | 一次用户消息驱动的完整回复周期：user → N × turn → final assistant。journal 落盘单位（一行一个 run 快照，`seq` = runSeq）；事件 `run-start` / `run-end` |
| **turn（请求轮）** | run 内一次 provider API 请求及其工具执行收口。无显式边界事件，由投影层从 tool-recorded 对推断；`curTurn` / `maxTurns`（每 run 最大 turn 数） |

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
   · 广播形态为 **ProjectedEvent**（投影事件流，见 PRD `output-投影层`）：工具调用以 `tool-recorded.started/recorded` 替代完整 request/response；完整 OutputEvent 只进 journal（重建源）

② journal 沙盒（持久，**落盘子集**）
   · 只记"按需落盘"的子集：user/assistant 消息 / tool-call-request / tool-call-response
   · 任何 Node 进程本地可读（tail 到完整行）；renderer 经 Main 代读
   · 已落盘内容的查询 / 历史 / 恢复的事实来源；**未落盘事件不存在于任何持久层**
   · 读取接口两个：`history`（完整 OutputEvent，重建用）/ `projectedHistory`（读 journal 后过投影层，返回 ProjectedEvent，与 hub 实时流同形态）

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
- **subagent 无 peers**：进程内派生。派生入口为 `SubagentRuntime.spawn`（经 Agent 工具 handler 闭包捕获 spawner；loop 保持无 subagent 概念——偏离原 `loop.spawnSubagent` 规划，因 ToolHandler 只收 ToolCall，spawner 须在装配期注入）；subagent 事件 live 进 hub 按 agentId 盖章、不落 journal（PRD §4.4）。
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

## 7. 接口层（✅ 已落地）

```ts
// contract/interaction/conversation.ts
interface ConversationInteraction {
  sendUserMessage(msg: ConversationUserMessage): Promise<Receipt>   // → loop.followup（入队）
  sendUserCommand(cmd: ConversationUserCommand): Promise<Receipt>   // → loop.followup（转文本）
  sendSystemControl(ctrl: ConversationSystemControl): Promise<Receipt>  // mode.set/stop/reload.config
}

// contract/interaction/waiting.ts —— 延迟 RPC（阻塞到决策）
interface WaitingInteractionRequest {
  sendApprovalRequest(req): Promise<ConversationApprovalDecision>   // 阻塞到 approve/reject/edit
  sendAskingQuestionRequest(req): Promise<string>                   // 阻塞到回答
  sendExitComposeRequest(req): Promise<void>                        // 阻塞到退出
}

// contract/types/message.ts —— 会话模式
type ConversationMode = "review" | "bypass" | "compose"   // 默认 review
type ConversationSystemControl =
  | { type: "stop" } | { type: "reload.config" } | { type: "mode.set"; mode: ConversationMode }
```

- **两个接口有区分**：`ConversationManagerServer.send*RequestTo` 是**转发接口**（经 cms 转发调目标 conversation）；`WaitingInteractionRequest` 是**会话侧接收接口**。
- **wait 是延迟 RPC（阻塞）**：`await sendApprovalRequest(req)` 挂起直到决策；决策/回答 = RPC 返回值，requestId = RPC 关联 id。
- **mode 时序**：`mode.set` 不立即生效——记 `pendingMode`，**下一次 turn 开始时**才切到 `activeMode`（避免影响进行中的 turn）。
- **AgentLoop 输入队列**：`followup`（turn lane，FIFO 排队）/ `steer`（control lane，高优先级注入 system reminder）/ `stop`（取消 + 清队列）。
- **事件域拆分**：`AgentLoop` 产出 `OutputEvent`（持久化域：LLMessage 消息 + run-start/end 边界，journal 事实源）与 delta（流域专属）；`Conversation` 分发处经 **ProjectionLayer** 映射出 `ProjectedEvent`（流域：消息/run 边界/delta + `tool-recorded.started/recorded` 投影），hub 广播与 `projectedHistory` 读取共用同一投影实现；工具可经 `ToolDef.preview` 定制投影内容（详见 PRD `output-投影层`）。
- **journal 按 run 存储**：写侧 `appendRun`（LLMessage），读侧 `history` 返回 `OutputEvent`（无 delta），进程无关。
- subagent 的审批：进程内由主 loop 决定；teammate 的审批路径：**经 manager 转发到 parent**（已定）。

---

## 8. 落地状态（✅ 全量落地）

### 8.1 层结构（`core/src/`）

```
runtime/
├── provider/      多模型（Anthropic/OpenAI/DeepSeek）+ 流式 + 错误分类 + 模型能力
├── tool/          ToolDef/ToolHandler/ToolGroupManifest/ToolDispatcher/MapToolDispatcher + definitions（files/novel/todo/compose）+ groups（NovelToolGroups）
├── prompt/        PromptSection 判别联合（static/dynamic）+ PromptRecipe/PromptSectionRegistry + sections（9 段）
├── agent/         AgentDefinition（值对象）/AgentAssembler/NovelAgent（buildNovelAgent）+ definitions（NovelAgentDefinition）
├── loop/          AgentLoop（输入队列 + round/turn）+ LoopContext（static base 缓存 + 动态输入通道 + beforeProviderCall 步骤⓪）
├── nudge/         ContextNudgePolicy + definitions（todo_idle/compose_mode 五件套）
├── compact/       ContextCompactPolicy + CompactPolicyChain
├── todo/          TodoProtocol + InMemoryConversationTodoStore
└── debug/         ProviderCallDebugger（jsonl + html diff）
conversation/      contract + persistence（journal + state.jsonl sidecar）+ server（Conversation/ManagerServer/Subagent/WaitRequestQueue）+ compose（状态机/服务/文案/canonical 名单）+ JournalBridge + projection（ProjectionLayer/CardProjection）
novel/             contract + model + InMemoryNovelStore（乐观锁）+ NovelDbServer + NovelHandle
rpc/               kkrpc（call/RPCError/transport）
event/             ZeroMQ（EventPublisher/Subscriber）
log/               pino（进程独占）
manager/           contract（ConversationManagerServer）
init/              ConversationInit + ProcessSpawner（bootstrap）
```

### 8.2 关键机制落地

- **乐观锁**：novel mutation `baseRevision` + 实体 `entityVersion`，stale 抛 `NovelStaleRevisionError`
- **compose mode**（✅ 落地，PRD `docs/PRD/compose-审批流.md`）：会话级三模式
  review/bypass/compose 双态（mode.set 记 pending + `mode.pending` 瞬态事件；每次 provider
  call 发起时经 `beforeProviderCall` 晋升 active + `mode.changed` 权威事件）；5 相位状态机
  （idle/designing/pending/applied/discarded）+ `ComposeModeService`（begin 幂等/旧草稿探测、
  submit/rejectOnDecision/exit 归档 archive/+sha256 审计/discard/setMode 延迟/hydrateFromEvents）；
  compose 激活时 gateBatch 硬拒绝 11 个 canonical 写（`canonicalTools.ts`，与按 turn 批量审批同一门），Read/文件工具全可用，
  bypass 模式 canonical 写免审（ExitComposeMode 不在名单恒走审批）；Exit 审批走通用审批通道
  （requireApproval + WaitRequestQueue，decisioner 派生 ui/parent，根会话 bypass 直接批准）；
  nudge 五件套（compose_mode/reentry/pending/exit/sparse，落点状态分发 + sparse 可配置缺省 5）；
  状态事件 sidecar `state.jsonl`（persist 子集）重启 hydrate 重放，孤儿 compose 回退 review；
  UI：审批面板 ExitComposeMode 特化（design 文件全文展示）+ 模式栏「待生效」chip +
  desktop design 文件 IPC（novel.design.v1.*，gui shared/main/renderer 三件套）
- **进程化**：novel-db 进程、conversation 子进程 spawn、teammate 派生（ManagerServer 双模式）
- **agent 装配**：声明式 `novelAgentDefinition`（9 段 recipe / 9 工具组 23 工具 / 2 nudge）经 `AgentAssembler` 解析为 `AgentCapability`；段 `id@version` 注册表解析；nudge 生效集 = `nudgeEnablement.enabled` ∩ 实现目录
- **system prompt 渲染**：static 段一次渲染进 base 缓存，dynamic 段每 provider call 渲染（`core.environment` 环境块 / `novel.global_constraints` NOVEL.md 注入 / `tool.guidance` 工具清单）；动态输入由 LoopContext 自组装（workdir/modelId）+ 宿主注入（platform 常量 / NOVEL.md 每调用 fs 读）
- **样式架构**（ui 包）：三层 token 模型（L1 结构常量 / L2 设计语言 / L3 语义色+阴影，
  dark 主题只覆盖 L3）+ 纪律测试（`ui/tests/theme/cssDiscipline.test.ts` 规则 a-d）+
  stylelint；keyframes 集中于 `shared/theme/animations.css`，模块 css 经
  `var(--anim-*)` 间接引用动画名。详见 `docs/development/ui-样式架构.md`
- **测试**：core 420 用例 / 59 文件全绿 + ui 296 用例全绿 + 真实 deepseek 多进程联调（ui 纪律测试见上）

### 8.3 剩余待办

1. **sqlite 驱动**：当前 novel 用内存 store，sqlite 持久化待接（better-sqlite3 vs worker）。
2. **delta chunk 聚合**：暂缓（delta 直走 kkrpc 背压）。
3. **subagent 事件交织修复**（根因已定位，修复前记录）：
   - 现象：subagent 合入后，真实 app 中 main turn 的工具调用展示消失（单测全绿但线上事件流与单测假设不同）。
   - 根因链：① subagent loop 无 startSeq → seq 从 1 重起（`NovelExplorerAgent.ts` 不传 startSeq）；② subagent 边界事件（run-start/user.message/delta/assistant.message/run-end）经 `Conversation.subagentRuntime.onEvent` 进共享 hub（live-only）；③ 客户端 `ConversationProjection` 单槽时间线被交织——subagent 的 user.message 提前 `finalizeAssistant()` 且不设 runEndSequence；④ 运行时 `assistant.delta` 实际携带 `seq: 0`（`AgentLoop.emit` 基底对象）→ 客户端 `"seq" in event` 判定把 lastAppliedSequence 打回 0 → main 流式项 `sourceSequence=0`；⑤ 归属范围坍缩为 [0,0] → `chatSurfaceMapper` 的 seq 范围过滤把 main 全部 toolTraces 滤光（模拟复现：main 大消息 traces=0、final 消息被挤 39 行）。
   - 次生：ProjectionLayer 的 pending 被 subagent 的 run-end 清空（长任务 tool-recorded 退化为 unknown）；mapper MAPPED_ITEM_CACHE 在流式停顿时冻结旧 toolTraces。
   - 修法（✅ 已实施，PRD `conversation-run-turn-术语统一`）：客户端按 agentId 隔离 subagent 事件（盖章即 subagent，非 main 不进时间线）；hub 内 ProjectionLayer 按 agentId 分实例（pending 互不可见）；排队 run 边界事件延迟到实际执行时发射（事件流顺序 = 执行顺序）。
4. **compose 后续**：根会话 compose 期间 teammate canon 写审批的细节（PRD §7.1）；
   teammate 审批的父会话侧主动裁决（本期仅 decisioner=parent 冒泡条目）。

### 8.4 偏离旧版（NovelAI）清单

工具策略与调度层对齐旧版语义，但有如下刻意偏离：

1. **无 groupIds**：旧版 `AgentToolPolicy{groupIds, allow?, deny?}` 依赖工具分组机制；新线无分组，策略 = `allow`/`deny` 直接工具名名单。池的来源二选一：builder 装配池（NovelAgent/NovelExplorerAgent）或 `InMemoryRegistry.buildCapability` 的版本匹配集（注册约定：工具 `version` 须等于目标 agent 的 `agentVersion`）。名单项不在池内抛 `TOOL_POLICY_INVALID`（非静默跳过）；`allow: []` = 空集（旧版拒空数组）。
2. **loop 工具错误回填模型（行为变更）**：`run` 不因工具错误 reject；catch 后 tool 消息内容 = `工具执行失败(${code}): ${message}`，**仍 append tool 消息**（否则下一轮 provider 缺 tool result 报 400），tool-call-response 事件只填 `error` 不填 `result`（激活卡片投影 failed 分支）；模型收到失败文本自纠，`maxTurns` 兜底。
3. **ToolError 单类 + code union**：codes = `TOOL_NOT_AVAILABLE` / `TOOL_DUPLICATE` / `TOOL_POLICY_INVALID` / `TOOL_ARGUMENTS_INVALID` / `TOOL_HANDLER_FAILED`；无 `TOOL_VERSION_MISMATCH`（新线 ToolCall 无 version，模型不传）；**保留 cause 与原始 message**（错误文本回填模型自纠需要；旧版不保留）。
