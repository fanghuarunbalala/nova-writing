# max_turn nudge（轮次预算提醒）PRD —— v0.1

> 关联文档：`external-tools-接入.md`（F5 nudge 纪元状态机）、`project-stage-nudge.md`（nudge 生命周期规格）。
> 复用机制：`ContextNudgePolicy` 双通道 + 纪元状态机 + nudge 标记清扫 + seed-scan 幂等（`core/src/runtime/nudge/`）。

## 1. 背景与目标

`AgentLoop` 目前对每 run 的轮次预算（`maxTurns`，主 agent 默认 100、子代理 20、resume 8）只做**硬熔断**：`curTurn` 耗尽时直接抛「达到最大轮次」异常（`AgentLoop.ts:466`），模型事前无任何预警。长任务（开书、正文创作、调研）在预算耗尽时被硬切断，产出残缺且无收尾过程。

目标：在预算将尽时，通过 nudge 通道**提前告知模型剩余轮次并要求收尾**，让模型在预算内推进到可交付结论（成稿 / Exit 决议 / 明确交代进度），减少硬切断造成的残缺输出。

## 2. 用户故事

- 作为用户，当一次长对话接近轮次上限时，我希望模型提前知道预算将尽并主动收尾，而不是毫无征兆地被打断。
- 作为开发，我希望该提醒复用现有 nudge 机制（标记清扫、幂等、纪元重置），而不是另造一套生命周期。

## 3. 流程图（必填）

### 3.1 触发求值（persistentNudgeIfNeeded，每 turn 一次）

```
toProviderCall（每 turn 一次）
  └─ persistentNudgeIfNeeded(loop, run)
       ├─ ① run 生命周期重置：curTurn===0（新 run 开始）或压缩纪元变化/clear → injected=false
       ├─ ② 窗口判定：run.curTurn >= run.maxTurn - N（N=3，v1 常量）？否 → 返回 false
       ├─ ③ 已注入（injected）？是 → 返回 false（每 run 至多一次）
       ├─ ④ 重启 seed-scan：本 run 消息流已含 max_turn 标记 → 置 injected，返回 false
       ├─ ⑤ 注入：appendRunMessages([{ role:"system", content: 提醒文案, nudge:"max_turn" }])
       └─ 返回 true（本 call 消息快照前追加，本 call 即可见）
```

### 3.2 消息生命周期（含压缩清除）

```
注入（带 nudge:"max_turn" 标记的 system 消息，落 journal）
  ├─ 正常流动：模型可见，直到 run 结束
  └─ 压缩发生（本轮消息过多触发 compactIfNeeded）
       ├─ LoopContext.sweepNudgeMessages() 删除流内所有 nudge 标记消息
       ├─ 纪元 +1（compactionGeneration 变化）→ 策略 injected 重置
       └─ 后续 turn 再次求值：若剩余轮次仍 ≤ N → 允许重注一次；否则不再注入
```

## 4. 功能明细

### F1 通道与标记

- 通道：**persistent**（`loop.appendRunMessages` 追加到当前 run，落 journal、本 call 可见），与 external_tools / project_stage 一致；transient 通道不使用（恒 false）。
- 标记：`MAX_TURN_NUDGE_MARK = "max_turn"`（nudgeId 与标记同名，供压缩清扫、T2 摘要输入过滤、seed-scan 识别）。
- 消息形态：`{ role: "system", content: <提醒文案>, nudge: "max_turn" }`。

### F2 触发条件（窗口阈值）

- 判定：`run.maxTurn` 已定义（RunProgress 初始化后恒有值，默认 100）且 `run.curTurn >= run.maxTurn - N`。
- 语义：剩余轮次（`maxTurn - curTurn`）≤ N 时进入提醒窗口。默认 `N = 3`（v1 常量 `DEFAULT_TURN_WINDOW`，可配化见 §7 开放问题）。
- 边界：`maxTurn <= N`（如极小预算）时首轮（curTurn 0）即满足窗口——提醒文案按实际剩余轮次书写，门控仍保证每 run 至多一次，不刷屏。
- 与硬熔断的关系：**不改变** `maxTurns` 行为；预算耗尽仍抛「达到最大轮次」异常（`AgentLoop.ts:466`），nudge 仅为提前预警。

### F3 注入内容（文案初稿，定稿前可改）

```
# 轮次预算提醒
本 run 已消耗 {curTurn} 轮，剩余 {maxTurn - curTurn} 轮即将耗尽（总预算 {maxTurn} 轮）。
请在剩余轮次内完成收尾：
- 优先推进到可交付的结论：成稿正文 / 完成决议 / 给出明确下一步；
- 若任务无法在预算内完成，明确交代已完成进度与剩余工作，不要静默中断。
```

- 占位符 `{curTurn}` / `{maxTurn - curTurn}` / `{maxTurn}` 由注入时实际值填充；curTurn 0 起算，文案口径与 `conversation-run-turn-术语统一.md` 一致（剩余轮次 = `maxTurn - curTurn`）。
- 渲染函数：`renderMaxTurnText(curTurn: number, maxTurn: number): string`（纯函数，可单测）。

### F4 每 run 一次门控与重置语义

- 策略实例维护 `injected` 标志，注入后置位；满足以下任一条件时重置：
  - **新 run 开始**（`curTurn === 0`，run 生命周期边界，避免上一 run 的注入标志阻塞下一 run）；
  - **压缩纪元变化**（`compactionGeneration` 变化）或 **messages 非空→空**（clear 兜底）——复用 external-tools 纪元跟踪（`lastCompactionGeneration` / `lastMessageCount`）。
- 窗口判定先于 injected 判定（重置后若已出窗口则不注入）。

### F5 压缩强制清除与重注

- 压缩链对带 `nudge !== undefined` 的流内 system 消息统一清扫（`LoopContext.sweepNudgeMessages`，T2 摘要输入过滤同样剔除）——max_turn 消息随清扫删除，无需特殊处理。
- 清扫后纪元重置 `injected`，若剩余轮次仍 ≤ N 则允许重注一次（预算不等人，重注是特性不是 bug）；出窗口则不重注。

### F6 重启幂等（seed-scan）

- 首次求值时扫描**当前 run**（journal 重放后 `loop.runs` 末尾）的消息流：若已存在 `nudge === "max_turn"` 的 system 消息，置 `injected` 不重发。
- 与 external_tools 的差异：external_tools 是**每纪元全局**扫描（任一 run 有标记即幂等），max_turn 是**当前 run 内**扫描——上一 run 的提醒不应阻塞本 run 的提醒。

### F7 装配

- `core/src/runtime/agent/NovelAgent.ts` `nudgeCatalog`（≈153-164 行）注册：`"max_turn" → () => new MaxTurnNudgePolicy()`（无构造依赖，或仅注入阈值常量便于测试注入）。
- `core/src/runtime/agent/definitions/NovelAgentDefinition.ts:73-74` `nudgeEnablement.enabled` 增加 `"max_turn"`。
- 生效集 = `enabled ∩ nudgeCatalog`（`AgentAssembler.resolveNudges`），随 AgentDefinition 持久化。

### F8 适用范围

- **v1 只启用主 agent（NovelAgent）**。子代理（Explore/Compose，maxTurns 20）与 resume 通道（8）不在 v1 启用范围——子代理是单轮回报短任务，硬切断影响小；resume 通道预算另行评估（见 §7 开放问题）。

## 5. 边界与非目标

- 不改变 `maxTurns` 语义、默认值、硬熔断行为。
- 不做「剩余 1 轮强提醒」等二次提醒（v1 每 run 至多一次）。
- 不做阈值可配化 UI / 配置项（v1 常量，见开放问题）。
- 不启用子代理与 resume 通道（v1）。
- 不引入新的通道或持久化机制——全部复用现有 nudge 基建。

## 6. 验收标准

1. 未到窗口（`curTurn < maxTurn - N`）：不注入，返回 false。
2. 进入窗口：注入一条带 `nudge: "max_turn"` 标记的 system 消息，文案含正确的已消耗 / 剩余 / 总预算轮数。
3. 同一 run 内窗口期多次求值：只注入一次（injected 门控）。
4. 新 run 开始（curTurn 回到 0）：重置门控，第二个 run 进入窗口时正常注入。
5. 压缩发生（纪元变化）且窗口期仍在：清扫后重注一次，不重复堆积。
6. 压缩发生在出窗口后：不重注。
7. 重启 seed-scan：当前 run 已含标记消息 → 不重发；标记在旧 run（非当前）→ 不阻塞当前 run 提醒。
8. `maxTurn <= N` 边界：首轮注入一次，不重复。
9. 装配：`nudgeEnablement.enabled` 含 `max_turn`，assembler 生效集包含该策略。
10. 全部用例走 `makeLoop` / `makeRun` 替身模式（对齐 `external-tools-nudge.test.ts`），不依赖真实 provider。

## 7. 开放问题

- **O1 阈值可配化**：`N=3` 是否需要进 `AgentRuntimeOverride` / AgentDefinition 配置（v1 常量，待有真实需求再开）。
- **O2 二次提醒**：是否需要「剩余 1 轮」时的强提醒（v1 不做，观察实际效果）。
- **O3 resume 通道**：`resumePendingRun` 硬编码 `maxTurns: 8` 的恢复场景是否需要提醒（v1 不启用，恢复流程语义另行评估）。
- **O4 子代理**：Compose 子代理（20 轮）是否需要（v1 不启用）。

## 8. 技术设计要点

- 新文件：`core/src/runtime/nudge/definitions/max-turn.ts`——`MaxTurnNudgePolicy implements ContextNudgePolicy`，零依赖（不需要 registry/query），构造可选注入阈值（便于测试）。
- 状态：`injected` / `seeded` / `lastCompactionGeneration` / `lastMessageCount`，与 external-tools 同构。
- 与 external-tools 策略的差异点（实现时注意）：
  1. 门控从「curTurn===0 每纪元一次」改为「窗口判定 + 每 run 一次」；
  2. 重置增加 run 边界（curTurn===0）；
  3. seed-scan 只扫当前 run（`loop.runs` 末尾）而非全部 run。
- 单测文件：`core/src/runtime/nudge/__tests__/max-turn-nudge.test.ts`（对齐 external-tools-nudge.test.ts 的 makeLoop/makeRun 模式）。

## 9. 实施步骤

1. `definitions/max-turn.ts`：`MAX_TURN_NUDGE_MARK` + `DEFAULT_TURN_WINDOW` + `renderMaxTurnText` + `MaxTurnNudgePolicy`。
2. `__tests__/max-turn-nudge.test.ts`：覆盖 §6 验收 1-8。
3. `NovelAgent.ts` nudgeCatalog 注册 + `NovelAgentDefinition.ts` enabled 声明。
4. 装配级断言（`agent-assembler.test.ts` / `novel-agent.test.ts` 模式）。
5. 全量单测 + CI 校验；回填 §10 落地记录。

## 10. 实施落地记录（v0.1 定稿后补）

- （实现后回填：实施偏差 / 文案定稿 / 测试实际例数。）
