# Nova Android —— Agent Runtime（M1+M2）

桌面端 Nova Writing（Electron + TS）的 Agent 运行时，用 **Kotlin 协程**平移的 Android 端实现。
本目录是嵌在主仓库内的**独立 Gradle 工程**（pnpm workspace 不感知），对应 PRD：
[`../docs/PRD/android-移动端MVP.md`](../docs/PRD/android-移动端MVP.md)。

> 状态：M1（运行时核心）+ M2（Room 数据层）已完成，全部单测桌面 JVM 跑绿。
> M4（Compose 壳 + 前台服务 + 通知审批）、M5（远程 MCP）见 PRD 里程碑。

## 快速开始

```bash
# 本机无全局 JDK/Gradle 时：任意 JDK17 + Gradle 8.14 即可（本机工具链在 D:\workplace\tools\）
export JAVA_HOME="D:\workplace\tools\jdk-17.0.20.1+1"

./gradlew test              # 全部模块单测（model/provider/runtime/data）
./gradlew :core:runtime:runDemo   # 端到端演示：打字机 + 审批 + 崩溃恢复（脚本化假模型，不触网）
```

依赖走阿里云镜像（`settings.gradle.kts`），国内网络无需代理。

## 模块结构

```
android/
├── core/model/     纯类型：LLMessage / ToolCall / JournalLine / StoredRun（零协程依赖）
├── core/provider/  Provider 接口 + OpenAICompatProvider（OkHttp 手解析 SSE，DeepSeek 兼容）+ FakeProvider
├── core/runtime/   AgentLoop（ReAct 循环）/ 工具三件套 / ApprovalGate / 压缩链 / JSONL journal / AgentSession
└── core/data/      Room：journal_events 事件表 + paragraphs 表（entity_version 乐观锁）
```

依赖 DAG（无环）：`model ← provider ← runtime ← data`；M4 的 `:app`（AGP + Compose）依赖全部。
**M1+M2 四个模块全是纯 Kotlin/JVM，不引 AGP/Android SDK**——桌面秒级单测、无 Google Maven 依赖，
`:core:*` 后续被 Android App 直接依赖时零改动。这本身就是「核心资产平台无关」论断的工程验证。

## 桌面端 → Android 端映射（面试讲解底稿）

| 桌面端（TS/Electron） | 本工程（Kotlin） | 文件 |
|---|---|---|
| AgentLoop.runTurnLoop | `AgentLoop.executeRun`：run/turn 循环、maxTurns、工具收口 | `runtime/…/loop/AgentLoop.kt` |
| AbortController 手动级联 | 结构化并发取消树（SupervisorJob → drain → run → 工具批 async） | `session/AgentSession.kt` + `loop/AgentLoop.kt` |
| gateBatch 审批门 + WaitRequestQueue | `ApprovalGate`：CompletableDeferred + 120s 超时按拒绝；**决策随 tool 消息落 journal（修复桌面端重启丢决策）** | `approval/ApprovalGate.kt` |
| journal.jsonl 单写者 Promise 链 | `JournalStore` 接口 + `JsonlJournalStore`（Mutex 串行 + 断行容忍）+ `RoomJournalStore`（同契约） | `journal/JournalStore.kt`、`data/…/RoomJournalStore.kt` |
| resumePendingRun 崩溃恢复 | `Recovery.settlePendingRun`：findPendingToolCalls + decider 补完 | `journal/Recovery.kt` |
| CompactPolicyChain T1/T2/T3 + 超窗保险丝 | 同名策略链（骨架化/摘要折叠/硬丢弃）+ CONTEXT_LENGTH 保险丝 forceCompact 重试一次 | `compact/Compact.kt` |
| 32ms delta 合并发增量 | `DeltaCoalescer`（时钟可注入）合并后发**累计文本**（StateFlow 友好，有意偏离） | `loop/DeltaCoalescer.kt` |
| OpenAI SDK SSE | OkHttp 逐行解析；取消桥接：主协程 await CompletableDeferred + call.cancel() 掐 socket | `provider/OpenAICompatProvider.kt` |
| node:sqlite + 手写 BEGIN/COMMIT | Room suspend DAO + 条件 UPDATE 乐观锁（entity_version）+ @Transaction rewriteAll | `data/…/Daos.kt` |
| 子进程 per conversation + kkrpc/ZeroMQ | 单进程：会话=协程作用域，事件=进程内 SharedFlow（沙箱无解释器可 exec） | `session/AgentSession.kt` |
| 每会话一份 design 文件 / compose 模式 | 不做（MVP 非目标） | — |
| MCP stdio 子进程 | 不做（M5 接 Streamable HTTP；工具层 schema/handler 分离已备好） | — |

## 关键语义（与桌面端对齐的行为契约）

1. **工具失败不中断 run**：`工具执行失败(code): msg` 作为 tool 消息回填，模型下轮自纠
   （否则 provider 缺 tool result 报 400）。→ `ToolFailureTest`
2. **审批按 turn 批量征询**，requestId = `approval:{cid}:{runSeq}:b{n}`；拒绝意见回填落盘；超时按拒绝。→ `ApprovalTest`
3. **事件顺序不变量**：非 delta 事件前必须 flush 合并缓冲（UI 看到的最终文本 == AssistantMessage）。→ `AgentLoopTest`
4. **取消树**：run 中途取消 → 静默 RunEnd(ABORTED)，已完成 turn 全在 journal；悬挂工具调用可被 Recovery 补完。→ `CancellationTest`
5. **journal 只追加**；压缩后 `rewriteAll` 全量重写是唯一重建路径；toolCall/tool 按 id 配对同留同删。→ `JournalRecoveryTest`、`CompactTest`
6. **双实现同契约**：JSONL 与 Room 跑同一套契约测试。→ `data/JournalContractTest`
7. **乐观锁**：`UPDATE … WHERE entity_version = :base` 返回 0 行 = 过期，报当前版本让模型重读自纠。→ `data/ParagraphOptimisticLockTest`

## 与桌面端的已知偏离（都有意为之）

- `AssistantDelta` 发**累计文本**而非增量：Compose/StateFlow 拿到即最新，跳中间态天然合理；代价是长回复重复传字符串（打字机场景可忽略）。
- 压缩链 M1 版按「首个实际压缩即短路」执行（桌面是单次 compact 内 T1→T2→T3 逐级重估）；T2 摘要器为注入式，M4 换主模型实现。
- token 估算用 字符/2 粗估（阈值信号用途足够；桌面端重估同样按字符比例）。

## 测试版图（34 个用例，`gradlew test` 全绿）

| 套件 | 覆盖 |
|---|---|
| AgentLoopTest（3） | happy path 事件序/journal 行序、maxTurns、重放重建 |
| ToolFailureTest（3） | handler 失败/参数非法/未知工具 → 结构化反馈不中断 |
| ApprovalTest（3） | 批准放行 / 驳回附意见 / 超时按拒绝 |
| CancellationTest（2） | 流式中取消静默收口、工具批取消留悬挂调用 |
| JournalRecoveryTest（4） | 追加重放、断行容忍、原子重写、悬挂补完 |
| CompactTest（4） | T1 骨架化幂等、T2 摘要只增不并、T3 丢最老、链短路+重写 |
| AgentSessionTest（4） | run 串行、审批状态机、stop 清队列、steer 注入 |
| OpenAICompatProviderTest（5） | MockWebServer：SSE 分片拼装/纯文本/429/超窗/401 |
| JournalContractTest（3） | JSONL 与 Room 同契约 + 双实现崩溃恢复 |
| ParagraphOptimisticLockTest（3） | 条件更新拒过期版本、条件删除、自增单调 |

## 后续里程碑（PRD §5 非目标之外）

- **M4**：`:app`（AGP + Compose）——ChatScreen 打字机（collectAsStateWithLifecycle）、审批 BottomSheet、
  `AgentForegroundService`（dataSync 类型，会话 scope 挂服务不挂 ViewModel）、Keystore BYOK、SavedStateHandle 恢复向导。
- **M5**：远程 MCP（Streamable HTTP 传输，工具层不变）、端间同步预留（事件流 + 版本向量 + 租约）。
