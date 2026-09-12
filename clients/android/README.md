# Nova Android —— Agent Runtime（M1+M2）+ 数据通道 + App 壳 + 真实数据接线（M4 阶段 3）

桌面端 Nova Writing（Electron + TS）的 Agent 运行时，用 **Kotlin 协程**平移的 Android 端实现。
本目录是嵌在主仓库内的**独立 Gradle 工程**（pnpm workspace 不感知），对应 PRD：
[`../docs/PRD/android-移动端MVP.md`](../docs/PRD/android-移动端MVP.md)。

> 状态：M1（运行时核心）+ M2（Room 数据层）+ M4 阶段 1-2 已交付；
> **M4 阶段 3（真实数据接线）已交付**——认证（Keystore 加密令牌）/项目设备真数据/BYOK Provider/
> 会话域（租约状态机 + AgentSession 全家桶 + 只读 Watcher 投影）/SSE 双通道/审批中心聚合/
> FGS+通知/崩溃与断线恢复可见化；debug 数据源开关可切回演示模式（FR11）
> （手写路由/返回优先级 sheet>抽屉>栈）+ 四主题（脚本从 demo oklch 生成 ThemeColors.kt）+
> 登录门强制 + ChatScreen 全量交互（打字机 delta/思考态/工具行三态/幽灵晋升/loadOlder 锚定）
> + 审批 Sheet（120s 倒计时/三型卡）+ 设置/设备/审批中心/书库/内容页骨架 + debug 演示浮条；
> 数据层 ChatRepository 接口按阶段3真实现设计（FakeChatRepository 脚本回放），EventReducer 纯函数
> JVM 可测。真机目检与 Roborazzi 截图基线顺延（无设备/本机 RNG 损坏，见 PRD 阶段2 §7）。
> 后续：M4 阶段 3-5（真实数据接线/内容 sheet 四栏/回归收尾）见 PRD 里程碑。

## 快速开始

```bash
# 本机无全局 JDK/Gradle 时：任意 JDK17 + Gradle 8.14 即可（本机工具链在 D:\workplace\tools\）
export JAVA_HOME="D:\workplace\tools\jdk-17.0.20.1+1"

./gradlew test                    # 全部模块单测（core 五模块 113 + :app 28，共 141 用例）
./gradlew :app:assembleDebug      # 阶段2 APK（adb install 即可跑演示时间轴）
./gradlew :core:runtime:runDemo   # 端到端演示：打字机 + 审批 + 崩溃恢复（脚本化假模型，不触网）
```

依赖走阿里云镜像（`settings.gradle.kts`），国内网络无需代理。`:app` 需本机 Android SDK
（`local.properties` 的 `sdk.dir`，gitignore）。

## 模块结构

```
android/
├── app/            Compose 壳 + 真实数据接线（M4 阶段 2+3）：单 MainActivity + 手写路由（v5：基座 ChatScreen +
│                   持久内容 sheet + 侧抽屉 306dp + 全屏路由）；四主题（scripts/gen-theme.mjs 从
│                   demo oklch 生成 ThemeColors.kt + 楷体子集 1.7MB）；ChatScreen 七件套（打字机/
│                   五态条/工具行/幽灵/追问/锚定/输入条）；审批 Sheet 三型卡；登录门（纯云端无本地
│                   出口）；EventReducer 纯函数 + FakeChatRepository（《长夜余烬》脚本时间轴）；
│                   debug 演示浮条（重置/主题/409/断线/只读旁路）。
│                   阶段3（真实数据接线）：ServerAppRepository/KeystoreTokenStore（AndroidKeyStore
│                   AES-GCM + DataStore）/BYOK 表单+GET /models 连通探测/会话域（ConversationRegistry
│                   本地发现+meta.json、LeaseCoordinator 状态机、ConversationCoordinator 装配
│                   AgentSession+HttpJournalStore+RemoteNovelStore+gate，只读分支 SSE Watcher 经
│                   JournalProjector 折叠复刻持有端 UI）/GlobalChannel+SseBridge 双通道（含跨用户
│                   泄漏兜底过滤）/ApprovalCenter 聚合/NovaForegroundService（dataSync 纯壳+谓词
│                   StateFlow）/通知双通道深链/恢复与补推 SysPill 可见化/数据源开关（重启生效）
├── core/model/     纯类型：LLMessage / ToolCall / JournalLine / StoredRun（零协程依赖）
├── core/provider/  Provider 接口 + OpenAICompatProvider（OkHttp 手解析 SSE，DeepSeek 兼容）+ FakeProvider
├── core/runtime/   AgentLoop（ReAct 循环）/ 工具三件套 / ApprovalGate / 压缩链 / JSONL journal / AgentSession
├── core/data/      Room v2：journal_events + paragraphs（entity_version 乐观锁）
│                   + pending_push（断线积压 10k 上限）+ journal_cache（SSE 离线只读缓存）
└── core/net/       数据通道（M4 阶段 1，纯 JVM）：ServerAuthSession（双令牌单飞轮换）/
                    HttpJournalStore（implements JournalStore，断线积压+镜像写通）/ LeaseClient /
                    ServerApprovalChannel（两段式）/ SseBridge（自写 SSE+退避重连+取消桥）/
                    CloudProjectsClient + RemoteNovelStore（投影+oplog）/ JournalMirror / DefinitionClient
```

依赖 DAG（无环）：`model ← provider ← runtime ← data ← net ← app`；`:app` 依赖 `:core:runtime`
`:core:*` 五个模块全是纯 Kotlin/JVM，
不引 AGP/Android SDK——桌面秒级单测、无 Google Maven 依赖，`:core:*` 后续被 Android App
直接依赖时零改动。这本身就是「核心资产平台无关」论断的工程验证。

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

## 测试版图（177 个用例，`gradlew test` 全绿）

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
| DefinitionBundleTest 等定义包（13） | 能力协商/动态渲染 parity 对拍/journal 盖章 |
| **:core:net（66）** | **auth**（轮换单飞并发只刷一次/复用检测→NeedRelogin/网络→Offline）；**HttpJournalStore**（上推字段对齐/replay 二次 parse/断线入队按序补推/10k 溢出/rewrite 409 携 currentLastSeq/镜像写通与收缩重建）；**NetJournalContract**（Http vs Jsonl vs Room 三实现同契约 + Recovery 兼容 + Room 队列保序/上限）；**JournalMirror**（尾序 gs 严格大于去重/半行容忍）；**LeaseClient**（409 携 holder/410 分类/心跳 onLost 退出/release 静默）；**ApprovalChannel**（上报体/pending calls_json 二次 parse/resolve 静默/SSE+本地先到者生效）；**SseBridge**（帧三分支/游标推进与 Rewritten 归零/退避序列与归零/重连携 since/stop 无悬挂）；**CloudProjects/RemoteNovelStore**（全端点错误码附值/投影收敛/sessionTag 自跳过/缓存命中免全量/损坏回退）；**DefinitionClient**（resolve 缓存/404 回退旧版/坏文件跳过） |
| **:app 阶段2（28）** | **EventReducer（13）**：提交空闲/运行进幽灵、RunStart 晋升（id 保持）、思考→生成切换点、delta 累计幂等、收口落块与重放幂等、工具行三态、审批征询/裁决/失序幂等、五态映射、历史回放去重、前插序、折叠与输入模式、租约；**LoopEventMapping（4）**：基本映射、arguments 审批载荷三型解析、坏载荷回落、Compacted 吞掉；**FakeChatRepository（6）**：虚拟时间全时间轴（思考窗口零 delta→首 delta、完整审批通过收口、驳回 ABORTED、stop 补发 ABORTED、幽灵排队自动接续双审批、loadOlder 两段后耗尽）；**AppNavState（5）**：返回优先级 sheet>抽屉>栈>退出纯函数 |
| **:app 阶段3（32）** | **KeystoreTokenStore（4）**：假加解密器往返/损坏自清理/明文回退/清空；**ServerAppRepository（5）**：登录 Online 映射+项目设备聚合、四类错误码文案、409 username_taken、建项目 POST+刷新、踢本机 NeedRelogin；**JournalProjector（4）**：整 run 全生命周期（含 RunEnd 终判合成）、悬挂 run 不合成、snapshot/append 行级、payload 数组/字符串双形态；**PaginationFold（3）**：limit+1 探测边界、页内升序+u-r id 幂等、不足页无 more；**LeaseCoordinator（9）**：Granted→Holder、Held→ReadOnly+UI 投影、心跳丢→Lost+停 run+接管横幅、device_revoked 联动登出、resume 双向、409 冲突框、Revoked→Lost、Error 留 Idle、release 幂等；**RealChatRepository（3）**：全链路（submit→审批上报→他端裁决→gate 放行→RunEnd 落账本）、断网入队恢复 drain+补推 SysPill、409 只读分支 Watcher 投影复刻；**ApprovalCenter（2）**：pending 聚合+卡级落批级、批级裁决落 server |
| **runtime/net 阶段3（4）** | **AgentSessionRecoveryTest（2）**：悬挂调用补完回调+事件流回填、干净 journal 不触发；**NovelStoreContractTest（2）**：InMemory 与 Remote(oplog) 双实现同契约（乐观锁过期/未知 id 语义） |

## 后续里程碑（PRD §5 非目标之外）

- **M4 阶段 4-5**：阶段 4 = 内容 sheet 四栏（大纲/正文/人物/地点投影）+ ui- 域通道（内容页手动编辑）+
  AskCard 真实交互 + 审批卡富化；阶段 5 = 回归收尾 + 截图基线（Roborazzi 重试）+ 真机清单固化。
  基准：`docs/design/android-app-demo.html`；每阶段先出 PRD（`docs/PRD/Android实施-阶段N-*.md`）后代码。
- **M5**：远程 MCP（Streamable HTTP 传输，工具层不变）、端间同步预留（事件流 + 版本向量 + 租约）。

## v2 架构方向：数据层 server 化（已立项，见 docs/PRD/端云架构-数据层server化.md）

端云分工已重新定义：**数据权威迁到 web server（`server/` 包，TS + Fastify + SQLite），runtime 留在端上（BYOK 直连模型）**。
对本工程的影响：

- `JournalStore` / 小说库接口不变，M4 增补 `HttpJournalStore` / `RemoteNovelStore` 实现（server REST + SSE）；
  Room 降级为**读缓存**（SSE 事件失效）。
- 审批门接 server 两段式队列：`onRequest` → `POST /v1/approvals`，任意端 resolve → SSE 决议回填
  ApprovalGate——「手机挂起、桌面批」由此成立。
- 租约由 server 仲裁（`POST /v1/leases`），run 执行前申请、心跳续期；多端只有一个能跑，其余只读看进度。
- 认证（账号密码 + JWT 双令牌）见 `docs/PRD/认证-登录与多端会话.md`；BYOK key 永不进 server。
- 跨端续跑 = server 重放 + 悬挂工具补完（本工程 `Recovery` 逻辑平移复用）+ 工具可用性声明降级。
