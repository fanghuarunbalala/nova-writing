# PRD：统一会话级持久 Mode（compose / review / bypass）

> 状态：已实施并验收 · 关联计划：`docs/novel-compose-mode-plan.md`（§3 已预留 `preComposeMode` 扩展位）

---

## 1. 背景与问题

当前架构里存在两个**脱节**的"模式"概念：

1. **core 的 compose 状态机**（`ComposeModeStateProvider`，纯内存）：真实生效，但**仅由 agent 调用 `EnterComposeMode` 工具触发**，前端无法主动进入；进程重启即丢。
2. **UI 的 ComposerModeBar**（plan / bypass / review）：纯前端本地 `useState`，发送消息时 mode 被 `ChatSurface.onSend` **丢弃**（`UserMessageInputEvent` 只有 `conversationId + text`），**从未到达 core——bypass/plan 是摆设**。

**深层缺陷**：mode 没有独立的持久化来源，一切依赖内存 + 事件 journal。若事件流后续被**裁剪/压缩**（compaction），连"会话当前处于什么模式"都无法可靠还原。

## 2. 目标（Goals）

1. **三态会话级 mode**：`review`（需审批，默认）/ `bypass`（直接执行）/ `compose`（设计模式）；预留扩展位（将来可加 `plan`）。
2. **前端可显式进入/退出**，不依赖 LLM 自觉——对齐 Claude Code 的 plan 模式体验（显式进入、持久保持、后续回复延续、显式退出）。
3. **mode 与 compose 会话状态独立持久化**，与事件 journal 解耦——**即使事件被裁剪，模式与进行中的 compose 会话依然正确**。
4. **进入路径统一**：前端 IPC（`conversation.mode.set`）与 agent 工具（`EnterComposeMode`）共享同一服务与持久状态；工具只是"主动进入 mode"的另一种途径。
5. **重启恢复**：child runtime 启动时从持久层还原 mode + compose 子状态。
6. **行为语义**：
   - agent 调 `ExitComposeMode` → **必走审批门**（现状不变）。
   - 用户主动切换 compose → review/bypass → **不走审批门**，走 `discard` 路径（发 `novel.compose.discarded`）。
   - **bypass 只跳过 canonical 写审批**；`ExitComposeMode` 审批是硬门，bypass 不跳过。

## 3. 非目标（Non-Goals）

- **不做 `plan` 模式**（只在类型/权限/reminder 上留好 switch 扩展点）。
- **不重命名** `ComposeModeStateProvider` / `ComposeToolService`（收窄波及；单独重构另议）。
- 不做跨会话全局 mode；每个 conversation 独立。
- v1 不实现"从 mode service 取消协调器中未决审批请求"的完整修复（见 §11 风险；UI 层缓解）。

## 4. 术语

| 词 | 含义 |
|---|---|
| `ConversationMode` | `"review" \| "bypass" \| "compose"` 三态，会话级 |
| base mode | 非 compose 时的持久模式（review/bypass） |
| compose 会话 | mode=compose 期间的一次设计流程（designing → pending → applied/discarded） |
| 权威状态 | workspace DB 中持久化的 mode + compose 子状态，是唯一事实来源 |
| 同步事件 | `novel.mode.changed` / `novel.compose.*`，跨进程实时同步通道，**不是事实来源** |
| 裁剪 | 未来对 journal 事件做 compaction/裁剪，旧事件可能被删 |

---

## 5. 需求详述

### 5.1 模式语义

| mode | canonical 写（Novel*Write/Edit） | 进入方式 | 退出方式 |
|---|---|---|---|
| `review`（默认） | 允许，触发审批 `ask` | 前端切换 | 前端切走 |
| `bypass` | 允许，跳过审批 `allow` | 前端切换 | 前端切走 |
| `compose` | 拒绝 `deny`；仅 design 文件可写 | 前端切换（IPC）/ agent 调 `EnterComposeMode` | agent 走审批门 / 用户主动切走（= discard） |

### 5.2 进入 / 退出流程（高层）

| 触发 | 路径 | 审批门 |
|---|---|---|
| 用户点 UI → compose | `conversation.mode.set{compose}` → handler → `modeService.setMode→begin()` | 无 |
| agent 调 `EnterComposeMode` | 工具 → 同一 `modeService.begin()` | 无（工具规则 allow） |
| 用户点 UI → review/bypass（在 compose 中） | `mode.set{target}` → handler → `modeService.setMode` → **discard 路径** | 无 |
| agent 调 `ExitComposeMode` | 工具 → 审批（ask）→ 批准 → `modeService.exit()` | **有（硬门，bypass 也不跳过）** |
| 普通切换 review ↔ bypass | `mode.set{target}` → handler → `modeService.setMode` | 无 |

### 5.3 持久化设计（核心）

**原则：mode 是权威持久状态，不是事件派生状态。**

- **base mode** 存在 workspace DB 的 `conversations.mode` 列（默认 `'review'`），1:1 于会话、恒存在——会话创建即落列默认值，生命周期与会话同长。
- **活跃 compose 会话子状态**存在伴随表 `conversation_compose_state`（phase=`designing|pending`、design_file_path、pre_mode），仅会话激活期间有行；结束（apply/discard）即删行。
- **终态历史**（applied/discarded）不持久化：由 journal 的 `novel.compose.*` 事件重建，属历史展示，可容忍裁剪丢失（见 §5.4 容忍度）。
- **写序（write-ahead）**：每次模式迁移 = ①内存状态迁移 → ②持久化 DB → ③发同步事件。DB 写是提交点；DB 写失败则整个操作中止、**不发事件**（杜绝幻影事件）。事件只是持久化结果的广播，不是逆过程。

**裁剪容忍度**：

| 状态 | 来源 | 裁剪后 |
|---|---|---|
| base mode（review/bypass/compose） | DB `conversations.mode` | **不丢** |
| 活跃 compose 会话（phase/file/pre_mode） | DB `conversation_compose_state` | **不丢** |
| compose 终态徽标（已批准/已放弃） | journal 事件 | 可能丢（历史展示，可接受） |

### 5.4 事件同步设计（核心）

**角色分工**：

- **DB = 事实来源**（authoritative），跨进程可读、裁剪无关。
- **事件 = 实时同步通道**：child 每次模式迁移后发 `novel.mode.changed`（含 compose 进入/退出时），`novel.compose.*` 维持现状——让打开中的投影/UI **无需重新拉取**即可实时更新。

**投影层（host）读 mode 的方式——播种 + 覆盖**：

1. **connect 时播种（权威）**：`ConversationProjectionController.connect` 已拉取 `conversation.getSnapshot()`；将 `metadata.mode` 播种进投影 store 的 `conversationMode` 字段。compose 活跃会话的 phase 由新 API `conversation.getComposeState()` 一并拉取播种（镜像既有 `getRuntimePresence()` 先例）。
2. **回放/实时覆盖（同步）**：`novel.mode.changed` 事件在投影 store 里 `applyModeChanged` 实时更新同一字段。
3. **一致性**：播种值来自 DB，事件值由 DB 迁移广播而来，二者恒同；**裁剪只会让事件缺失，播种兜底，绝不回退到错误 mode**。

**为什么不能用纯事件派生**：若投影 `conversationMode` 仅靠 `novel.mode.changed` 重建，裁剪后回放为空 → 默认 review，而真实 mode 是 bypass——静默错误。播种使投影在"无事件"时也正确。

**agent 自动进入 mode，前端必同步（验收点）**：agent 调 `EnterComposeMode` 与前端切换走**同一 `modeService.begin()`**，注入的是 `PublishingRuntimeEventSink`（与普通工具事件同一 journal 通道）。`begin()` 发的 `novel.compose.begin`（既有）→ 设计卡/徽标；`novel.mode.changed`（新增）→ 投影 `applyModeChanged` 实时更新 `conversationMode` → bar 切换。host 投影经 live 订阅**实时**收到，无需刷新。DB 写 → 事件发的 write-ahead 顺序保证：崩溃在两者之间只影响当次广播，DB 已权威，下次 connect 播种兜底（最终一致）。

### 5.5 权限

`ComposeAwareToolPermissionPolicy` 原地泛化为 mode-aware（保留类名）：

| snapshot 状态 | canonical 写 | 其余工具 |
|---|---|---|
| `active`（compose 会话中） | `deny(compose.canonical_write_denied)` | file 工具限 design 目录/文件（现状） |
| `!active && mode === bypass` | `allow(mode.bypass_canonical_write_allow)` | 落 base |
| `!active && mode === review` | 透传 base（→ 既有 ask） | 落 base |

- **bypass 边界正确性**：`ExitComposeMode` 不在 canonical 写集合，bypass 分支不触达 → 落 base → `child_compose_exit_ask` → 硬门保留。
- `EnterComposeMode` 维持 allow（`child_compose_enter_allow`）。

### 5.6 提示层（reminder）

`NovelComposeModePromptSection.renderDynamic` 按 mode 渲染：

- `compose` → 现有 phase 文本（designing/pending 约束）不变。
- `bypass` → "当前为直接执行模式：canonical 写跳过审批直接落库；ExitComposeMode 退出审批不可跳过。"（把硬门边界讲给 agent）。
- `review` / 无 → 空串（默认保持干净，不污染每轮 prompt）。
- 动态输入注入加 `mode` 字段。

### 5.7 UI

- `ComposerModeBar` 从摆设接线为真实 mode 读写：三态（review 需审核 / bypass 直接执行 / compose 设计），去掉 plan。
- `ConversationComposer` 改为受控组件（props `mode` + `onModeChange`）；`onSend` 不再携带 mode。
- 切换发 `ConversationModeSetInputEvent` 经既有 `inputEnqueue` 单通道。
- mode 显示读投影 `snapshot.projection.conversationMode ?? "review"`；compose 徽标/设计卡沿用 `novel.compose.*` 事件映射（现状）。
- **用户主动退出 compose**（UI 切 review/bypass）无需审批门：child 内 `setMode→discard`，UI 只发 `mode.set`，设计卡/徽标随事件更新。

### 5.8 API / IPC

- **无新 IPC 通道**：全部走既有 `conversation.inputEnqueue` 单通道（`bridge.request`）；`coreEventSchemaRegistry.validateInput` 已 `allowUnknownEventType`，新事件类型直接通过。
- 新增输入事件 `conversation.mode.set`，payload `{ mode }`，走 **control lane**（抢占 turn）。
- 新增输出事件 `novel.mode.changed`，走 `NovelComposeOutputEvent` 机制（`novel.${eventName}` 拼名）。
- `ConversationSnapshot.metadata` 白名单（`validateConversationSnapshot`）加 `mode`（一行），使投影播种拿到权威值。
- 新增 `conversation.getComposeState()`（镜像 `getRuntimePresence()`）供投影播种 compose phase。

---

## 6. 好处 / 坏处（Trade-offs）

### 6.1 权威持久化 vs 事件派生（mode）

| | 持久化权威（选此） | 纯事件派生 |
|---|---|---|
| 裁剪容忍 | 高，DB 播种兜底 | 低，裁剪即丢 |
| 单一事实来源 | 有（DB） | 无（事件为主，易被清理策略影响） |
| 实现复杂度 | 需 API 透传 + 投影播种（略增） | 低，现状 |
| 一致性 | 双通道需一致（DB 写 → 事件发） | 单通道 |

结论：mode 属于"必须始终正确"的会话状态，值得独立持久化。事件裁剪是既定方向，不可把正确性押在事件上。

### 6.2 列 + 伴随表 vs 单张独立表

- `conversations.mode` 列：mode 1:1 于会话、恒存在，列默认值最省、读热路径无 join（precedent：v6 的 title/pinned）。
- `conversation_compose_state` 伴随表：compose 子状态稀疏（仅激活期有行），独立生命周期（结束即删），与热 catalog 行解耦。
- 两者合计即"mode 单独持久化"——与事件 journal 完全解耦。
- 备选"单张 `conversation_mode` 表"不采用：每次读要 join + 默认值 coalesce，catalog 热路径不必要地变复杂。

### 6.3 投影"播种 + 覆盖" vs 仅读 catalog

- 播种进投影：mode 随既有事件流实时更新，UI 单一订阅源；connect 时一次性播种，裁剪无关。
- 仅读 catalog 元数据：权威但**无实时性**（catalog 只在 loadWorkspace/create/rename/pin 刷新），切换后 bar 会过期，仍需事件/重拉。故选播种方案。

---

## 7. 流程（时序）

### 7.1 用户切换进入 compose

```
UI 点"设计"
 → enqueue(ConversationModeSetInputEvent{mode:'compose'})
 → inputEnqueue 单通道 → child 路由 → control lane
 → RuntimeConversationModeSetInputHandler
 → modeService.setMode(cid,'compose') → begin()
    ├ 建 design 文件；state.enter(phase=designing, pre_mode=原mode)
    ├ 持久化： conversations.mode='compose' + 插 compose_state 行(designing)
    └ 发事件： novel.compose.begin + novel.mode.changed{mode:'compose'}
 → host 投影： 徽标"设计中"、设计卡出现、bar 显示"设计"
 → 后续轮： reminder 渲染 compose 约束；canonical 写被拒；仅 design 文件可写
```

### 7.2 agent 进入 compose（等价路径，前端实时同步）

```
agent 调 EnterComposeMode → 工具(allow) → 同一 modeService.begin()
 → 同一持久化 + 同一事件(需求 4：进入方式统一)
 → host 投影 live 订阅实时收到 novel.compose.begin + novel.mode.changed
 → 前端： 设计卡/徽标"设计中" + bar 切到"设计"(无需刷新，最终一致由播种兜底)
```

### 7.3 用户主动退出 compose（不走审批门）

```
UI 点"需审核/直接执行"
 → mode.set{review|bypass} → control handler → modeService.setMode(target)
    ├ state.discard()(phase=discarded, mode=pre_mode)
    ├ 删 design 文件；删 compose_state 行
    ├ state.setMode(target)；持久化 conversations.mode=target
    └ 发事件： novel.compose.discarded + novel.mode.changed{mode:target}
 → UI： 设计卡"已放弃"、徽标消失、bar 更新
```

### 7.4 agent 退出 compose（审批门）

```
agent 调 ExitComposeMode → 权限 ask(bypass 也不跳过) → 审批卡
 → 用户批准 → modeService.exit()
    ├ state.approve()(phase=applied, mode=pre_mode)
    ├ 归档 design 文件 + 审计 commit
    ├ 持久化 conversations.mode=pre_mode；删 compose_state 行
    └ 发事件： novel.compose.applied + novel.mode.changed{mode:pre_mode}
 → UI： 设计卡"已批准"，mode 恢复
```

### 7.5 重启恢复

```
child 启动 → #createOnce
 ├ 打开 workspace store(.conversations)
 ├ modeService.hydrate(cid)：
 │   ├ 读 conversations.mode
 │   ├ mode='compose' → 读 compose_state 行 → state.enter(+pending 则 submit)
 │   └ 否则 state.setMode(mode)
 └ runtime.start()
host 投影 connect：
 ├ getSnapshot → metadata.mode 播种 store.conversationMode
 ├ getComposeState → 播种活跃 phase
 ├ 回放事件(覆盖，裁剪缺失则播种兜底)
 └ live 跟随
```

---

## 8. 数据模型

**迁移 v7（workspace DB `novel.db`）**
```sql
ALTER TABLE conversations ADD COLUMN mode TEXT NOT NULL DEFAULT 'review';
CREATE TABLE conversation_compose_state (
  conversation_id   TEXT PRIMARY KEY,
  phase             TEXT NOT NULL CHECK (phase IN ('designing','pending')),
  design_file_path  TEXT NOT NULL,
  pre_mode          TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
) STRICT;
```
- 刻意不给 `conversations.mode` / `pre_mode` 加 CHECK（SQLite 改 CHECK 需重建表，违背扩展性）；在类型边界用 `isConversationMode` 守卫。
- `conversation_compose_state` 只存活跃会话（designing/pending）；applied/discarded 删行，由事件重建历史。

**类型（core）**
- 新增 `ConversationMode = "review" | "bypass" | "compose"`，`DEFAULT_CONVERSATION_MODE = "review"`，`isConversationMode` 守卫。
- `ConversationMetadata.mode?: ConversationMode`；`ConversationRow`/`mapConversationRow` 透传；`ConversationSnapshot.metadata.mode` 过白名单。
- `ConversationProjectionSnapshot.conversationMode?: ConversationMode`（投影播种/覆盖字段）。

---

## 9. 兼容性与迁移

- 老库升级：v7 迁移幂等执行，既有 `conversations` 行 `mode` 落默认 `review`；无 compose 会话者无 `conversation_compose_state` 行。
- 既有 journal 事件**不需要迁移**：新旧 `novel.compose.*` 事件均被投影既有映射消费；新增 `novel.mode.changed` 为增量。
- 无会话状态者行为不变（review 即现状：canonical 写 ask）。

---

## 10. 验收与测试

- **core smoke**（`pnpm --dir core smoke:all`）：
  - `prompt-compose-mode-smoke`：bypass 渲染"直接执行"、review 空、compose designing/pending 不变；断言动态输入带 `mode`。✅
  - `novel-compose-tools-smoke`：setMode 三态迁移、compose→review discard（发 `novel.compose.discarded`+`mode.changed`、状态 discarded、mode 恢复）、bypass 下 `ExitComposeMode` 仍 ask。✅
  - `child-novel-tool-registry-smoke` / `child-tool-execution-wiring-smoke`：registry 返回 `modeService`；不传 store port 向后兼容。✅
  - `conversation-runtime-*`：mode.set control 事件 → handler 记 consumed、不拖垮 pump。✅
  - **新增** `conversation-mode-set-persistence-smoke`：真实 `SqliteWorkspaceStore`（临时目录）→ v7 后 mode=review → setMode(bypass) 关店重开 hydrate 恢复 → setMode(compose) 有行 → 模拟批准 exit() 行删、mode 回 bypass → compose→review discard 清行 → mode=compose+pending 恢复为 pending 快照。✅
  - **裁剪模拟**：播种路径断言——投影 store 仅构造 + `seedConversationMode(bypass)`、无任何 `mode.changed` 事件时，快照 `conversationMode === "bypass"`。✅
- **UI**：`pnpm --dir ui` 检查/测试通过；`pnpm --dir gui build` 通过。
- **端到端手动**：bar 三态切换生效；agent EnterComposeMode → bar/徽标反映；重启恢复；compose 下 canonical 写被拒；bypass 写直达；ExitComposeMode 在 bypass 下仍弹审批卡。

---

## 11. 风险与未决

1. **discard-during-pending 残留审批卡**：mode.set compose→review 时协调器仍持未决审批（15min 过期），GUI 全局审批 store 可能残留旧卡。v1 缓解：UI 见 `novel.compose.discarded` 时丢弃对应待决卡（UI 已按 `novel.compose.*` 键控）；完整修复需把 `InteractionCoordinator` 注入 mode service 以主动取消，延后。
2. **权限策略 inactive 短路语义变化**：bypass 分支会让包装器在 compose 非激活时也短路 base。核对 `INITIAL_TOOL_PERMISSION_RULES` 的 read/enter allow 规则不被 shadow。
3. **双通道一致性**：DB 写后发事件；若事件发射失败，DB 已权威，下次 connect 重新播种——不产生静默错误，但需在服务层保证"先持久化后发事件"的顺序。
4. **投影播种顺序**：connect 先播种（DB）再回放（事件覆盖）；store 的 seed 方法需幂等、可在 resume 时重复调用。
5. **compose 终态历史依赖事件**：applied/discarded 徽标在裁剪后可能缺失，属历史展示，接受；若后续要完整历史，扩展持久化（不在本 PRD 范围）。
