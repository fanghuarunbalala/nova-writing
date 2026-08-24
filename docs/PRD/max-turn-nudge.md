# max_turn nudge（轮次预算提醒）PRD —— v0.3

> 关联文档：`external-tools-接入.md`（F5 nudge 纪元状态机）、`project-stage-nudge.md`（nudge 生命周期规格）。
> 复用机制：`ContextNudgePolicy` 双通道 + 纪元状态机 + nudge 标记清扫 + seed-scan 幂等（`core/src/runtime/nudge/`）。
> v0.1 → v0.2：单级提醒改为**两级递进**（warn + final）——final 级直接针对"最后一轮仍发 tool_call → 熔断抛异常"的最坏失败模式；补 wire 归一化/UI 说明；剩余轮次口径明确化。
> v0.2 → v0.3：**生效范围扩为全部 agent**（用户定稿）——主 / ProjectImporter / BookAnalyst / Explore / Compose 五个 agent + resume 通道，装配矩阵与接线明细见 F8/F9。变更明细见 §10。

## 1. 背景与目标

`AgentLoop` 目前对每 run 的轮次预算（`maxTurns`，主 agent 默认 100、子代理 20、resume 8）只做**硬熔断**：`curTurn` 耗尽时直接抛「达到最大轮次」异常（`AgentLoop.ts:466`），模型事前无任何预警。

关键在收尾分支的结构（`AgentLoop.ts:449-466`）：只有**最后一轮响应不带 tool_call** 才走 final 分支正常收口（`run-end` 事件 + return）；带 tool_call 则执行完工具后循环退出、抛异常。也就是说，即使模型"想收尾"，只要最后一轮误发了一个 tool_call，整个 run 就以异常告终，成果以错误形式呈现。

目标（两级递进）：

1. **warn 级**：预算将尽（剩余 ≤3 轮）时提前告知，让模型主动规划收尾；
2. **final 级**：最后一轮（剩余 =1）时强提醒"不要再调用工具，立即给出最终回复"——若模型服从，run 走 final 分支**正常收口**，熔断异常根本不发生。

## 2. 用户故事

- 作为用户，当一次长对话接近轮次上限时，我希望模型提前知道预算将尽并主动收尾，而不是毫无征兆地被打断、拿到一个报错。
- 作为开发，我希望该提醒复用现有 nudge 机制（标记清扫、幂等、纪元重置），不另造生命周期。

## 3. 流程图（必填）

### 3.1 触发求值（persistentNudgeIfNeeded，每 turn 一次）

```
toProviderCall（每 turn 一次）
  └─ persistentNudgeIfNeeded(loop, run)
       ├─ ① 重启 seed-scan（仅首次）：扫当前 run 消息流，max_turn / max_turn_final
       │     标记已存在 → 置对应 injected，不重发
       ├─ ② 生命周期重置：curTurn===0（新 run）或压缩纪元变化 / messages 非空→空
       │     → 两级 injected 全部复位
       ├─ ③ 口径：remaining = maxTurn - curTurn（含本轮——本轮响应即将发生）
       ├─ ④ final 窗口：remaining <= 1 且 finalInjected=false
       │     → 注入 final 提醒（标记 max_turn_final），finalInjected=true，返回 true
       │     （同轮两级同时满足时只注 final，不叠加 warn）
       ├─ ⑤ warn 窗口：remaining <= WARN_WINDOW（=3）且 warnInjected=false
       │     → 注入 warn 提醒（标记 max_turn），warnInjected=true，返回 true
       └─ 其余：返回 false（求值先于消息快照，注入本 call 即可见）
```

### 3.2 消息生命周期（含压缩清除）

```
注入（带 nudge 标记的 system 消息，落 journal）
  ├─ 正常流动：模型每轮可见，直到 run 结束
  └─ 压缩发生（compactIfNeeded 实际压缩）
       ├─ LoopContext.sweepNudgeMessages() 删除流内所有 nudge 标记消息（两级一起清）
       ├─ 纪元 +1（compactionGeneration 变化）→ 两级 injected 复位
       └─ 后续 turn 再求值：各自窗口仍满足 → 各自允许重注一次（独立判定）
```

### 3.3 两级时序示例（maxTurn=100，WARN_WINDOW=3）

```
curTurn=96（remaining=4）：不注入
curTurn=97（remaining=3）：注入 warn「已消耗 97 轮，剩余 3 轮（含本轮）…请开始收尾」
curTurn=98（remaining=2）：warnInjected 已置位，不再注入
curTurn=99（remaining=1）：注入 final「这是最后一轮，不要再调用工具，立即给出最终回复」
  └─ 模型服从 → 响应无 tool_call → final 分支正常收口（run-end），熔断异常不发生
  └─ 模型不服从 → 工具执行后循环退出 → 抛「达到最大轮次」（现状兜底，不软化）
```

## 4. 功能明细

### F1 通道与标记

- 通道：**persistent**（`loop.appendRunMessages` 追加到当前 run，落 journal、本 call 可见），与 external_tools / project_stage 一致；transient 通道不使用（恒 false）。
- 标记（两个，seed-scan 需区分两级）：
  - `MAX_TURN_NUDGE_MARK = "max_turn"`（warn 级）
  - `MAX_TURN_FINAL_NUDGE_MARK = "max_turn_final"`（final 级）
- nudgeId（装配目录键）：`"max_turn"`（一个策略同时管两级，不拆两个策略）。
- 消息形态：`{ role: "system", content: <文案>, nudge: <对应标记> }`。

### F2 口径与窗口阈值

- 口径：`remaining = maxTurn - curTurn`，**含本轮**（本轮响应即将发生，模型还有本次机会）。`curTurn` 为即将发生的请求轮序号（0 起算），故"已消耗 curTurn 轮"与"剩余 maxTurn - curTurn 轮（含本轮）"同时成立。与 `conversation-run-turn-术语统一.md` 一致。
- warn 窗口：`remaining <= WARN_WINDOW`，`WARN_WINDOW = 3`（v1 常量，构造可注入便于测试）。
- final 窗口：`remaining <= 1`（即 `curTurn === maxTurn - 1`，最后一轮）。
- 边界：`maxTurn = 1` 时 curTurn=0 即 remaining=1，两级同轮同时满足 → **只注 final**（escalation 塌缩，避免单轮叠两条）；`maxTurn = 2` 时首轮注 warn、次轮注 final。
- 与硬熔断的关系：**不改变** `maxTurns` 行为；不服从 final 提醒仍抛异常（现状兜底，见 §5）。

### F3 注入内容（文案初稿，定稿前可改）

**warn 级**（`renderMaxTurnText(curTurn, maxTurn)`，纯函数）：

```
# 轮次预算提醒
本 run 已消耗 {curTurn} 轮，剩余 {remaining} 轮（含本轮，总预算 {maxTurn} 轮）。
请在剩余轮次内完成收尾：
- 优先推进到可交付的结论：成稿正文 / 完成决议 / 给出明确下一步；
- 若任务无法在预算内完成，明确交代已完成进度与剩余工作，不要静默中断。
```

**final 级**（`renderMaxTurnFinalText(curTurn, maxTurn)`，纯函数）：

```
# 最后一轮提醒
这是本 run 的最后一轮（第 {curTurn + 1} 轮 / 共 {maxTurn} 轮）：本轮之后预算耗尽。
不要再调用任何工具——后续工具调用将不会被处理，本次运行会以错误收场。
立即给出最终回复：交付已完成的内容，并交代未完成部分与建议的下一步。
```

- 两个渲染函数均为纯函数，可独立单测。

### F4 每 run 每级一次门控与重置语义

- 策略实例维护 `warnInjected` / `finalInjected` 两个标志；置位后同 run 内该级不再注入。
- 复位条件（任一满足，两级一起复位）：
  - **新 run 开始**（`curTurn === 0`，run 生命周期边界）；
  - **压缩纪元变化**（`compactionGeneration` 变化）或 **messages 非空→空**（clear 兜底）——复用 external-tools 纪元跟踪（`lastCompactionGeneration` / `lastMessageCount`）。
- 求值顺序：final 窗口先于 warn 窗口判定（同轮双门只注 final）。

### F5 压缩强制清除与重注

- 压缩链对带 `nudge !== undefined` 的流内 system 消息统一清扫（`LoopContext.sweepNudgeMessages`，T2 摘要输入过滤同样剔除）——两级消息随清扫删除，无需特殊处理。
- 清扫后纪元复位两级标志，各自窗口仍满足则各自重注一次（预算不等人）；出窗口不重注。

### F6 重启幂等（seed-scan）

- 首次求值时扫描**当前 run**（`loop.runs` 末尾）的消息流：`max_turn` / `max_turn_final` 标记分别置位对应 injected，不重发。
- 与 external_tools 的差异：external_tools 扫**全部 run**（每纪元全局幂等），本策略只扫当前 run——上一 run 的提醒不应阻塞本 run 的提醒。

### F7 wire 归一化与 UI（v0.2 补，零改动自动获益）

- journal 内形态为 system + nudge 标记；**wire 层由适配器边界统一转译**为 user + `<system-reminder>` 标签（`62eef76d`，覆盖全部 nudge 注入源，OpenAI/Anthropic 双适配器一致）。本策略不写任何 wire 层代码。
- UI：无特殊处理，与 external_tools 等现有 nudge 消息同规则流动展示。
- 模型侧辨识框架：`context.reliability` 静态段（v1.1.0，主/子代理 recipe 均含）已说明 `<system-reminder>` 语义，无需新增静态段。

### F8 装配（v0.3：全部 agent）

五个 agent 的 nudge 装配矩阵（`AgentAssembler.resolveNudges` = `enabled ∩ nudgeCatalog`，两侧都加才生效）：

| Agent | builder | nudgeCatalog 来源 | 接线改动 |
| --- | --- | --- | --- |
| Novel（主） | `buildNovelAgent` | `NovelAgent.ts` nudgeCatalog（4 项） | catalog + definition.enabled 各加 `max_turn` |
| ProjectImporter | `buildNovelAgent` 换 definition（entrypoint:728） | 复用主 agent catalog | 仅 definition.enabled 加 `max_turn` |
| BookAnalyst | `buildBookAnalystAgent`（自有 catalog，现仅 todo_idle） | `BookAnalystAgent.ts` | catalog + definition.enabled 各加 |
| Explore | `buildNovelSubagent` | **现状不传 catalog**（assembler 默认空 Map） | `NovelSubagent.ts` 新建子代理 catalog（仅 max_turn）+ definition 声明 enabled |
| Compose | `buildNovelSubagent` | 同上 | 同上 |

- 子代理 catalog **只放 `max_turn`**：external_tools（依赖 DeferredToolRegistry/MCP）、project_stage（依赖 novel-db 异步查询）、compose_mode（依赖 composeState）均需要子代理 builder 没有的构造依赖，不在本次扩大。
- resume 通道（entrypoint `resumePendingRun({maxTurns: 8})`）复用主 agent 装配的同一个 loop → 自动生效，零接线（remaining 按恢复预算 8 计算）。

### F9 适用范围（v0.3：全部 agent）

- **五个 agent 全部启用**：主 / ProjectImporter / BookAnalyst / Explore / Compose；resume 通道经主 agent loop 自动生效。
- **子代理侧设计说明**：
  1. live-only 兼容：子代理 loop 不落 journal，nudge 消息只进内存消息流（appendRunMessages 无 listener 依赖）；事件桥/UI 可见性沿用现有行为，不做特殊处理。
  2. 每任务新实例：SubagentRuntime 每任务经 builder 新建 loop → 策略每任务新实例 → "每 run 每级一次"语义天然成立；seed-scan 在一次性 loop 上空转，无害。
- **窗口适配**：子代理 maxTurns=20 → warn 第 17 轮（remaining=3）/ final 第 19 轮；resume maxTurns=8 → warn 第 5 轮 / final 第 7 轮——两级递进在短预算下依然成立（同轮双门塌缩兜底 maxTurn≤1）。

## 5. 边界与非目标

- 不改变 `maxTurns` 语义、默认值、硬熔断行为；**不软化熔断路径本身**（异常收口 → 优雅降级）——final 级提醒已把大部分耗尽场景转化为正常收口，模型不服从时维持现状兜底，错误信息本身对用户是有效信号。
- 不做三级及以上递进（两级已覆盖"预警 + 止损"两个语义位）。
- 不做阈值可配化 UI / 配置项（v1 常量，见 O1）。
- 不扩大子代理 catalog 的其他 nudge（见 F8）。
- 不引入新的通道或持久化机制——全部复用现有 nudge 基建。

## 6. 验收标准

1. 未到 warn 窗口（`remaining > 3`）：不注入，返回 false。
2. 进入 warn 窗口（`remaining <= 3`）：注入一条带 `nudge: "max_turn"` 的 system 消息，文案含正确的已消耗 / 剩余（含本轮）/ 总预算轮数。
3. 同一 run 内 warn 窗口多次求值：只注入一次。
4. final 窗口（`remaining = 1`）：注入一条带 `nudge: "max_turn_final"` 的 system 消息，文案含"不要再调用工具"语义；同 run 只注入一次。
5. 两级都在流内：remaining=3 注 warn 后运行到 remaining=1 注 final，两条消息共存、标记各自正确。
6. `maxTurn = 1`（首轮即末轮）：只注 final，不叠 warn。
7. 新 run 开始（curTurn 回 0）：两级标志复位，第二个 run 各窗口正常注入。
8. 压缩发生（纪元变化）且窗口期仍在：清扫后按各自窗口重注，不重复堆积；压缩发生在出窗口后：不重注。
9. 重启 seed-scan：当前 run 已含对应标记 → 对应级不重发；标记在旧 run（非当前）→ 不阻塞当前 run 注入。
10. 装配：五个 agent 的 `nudgeEnablement.enabled` 均含 `max_turn`，assembler 生效集包含该策略（主/Importer 经 buildNovelAgent、BookAnalyst 自有 catalog、Explore/Compose 经 NovelSubagent catalog）。
11. 全部用例走 `makeLoop` / `makeRun` 替身模式（对齐 `external-tools-nudge.test.ts`），不依赖真实 provider；两个渲染函数有独立纯函数用例。

## 7. 开放问题

- **O1 阈值可配化**：`WARN_WINDOW=3` 是否进 `AgentRuntimeOverride` / AgentDefinition（v1 常量，有真实需求再开）。
- **O2 warn 文案的窗口是否需要按任务类型调**：长文创作 3 轮可能偏紧（正文推进链长），观察实际效果再调。（v0.2 的 O3 resume / O4 子代理已在 v0.3 并入正文生效范围，不再是开放问题。）

## 8. 技术设计要点

- 新文件：`core/src/runtime/nudge/definitions/max-turn.ts`——`MaxTurnNudgePolicy implements ContextNudgePolicy`，零外部依赖；构造可选注入 `warnWindow`（默认 3，测试用）。
- 状态：`warnInjected` / `finalInjected` / `seeded` / `lastCompactionGeneration` / `lastMessageCount`。
- **纪元基线偏离 external-tools 模板（有意）**：external-tools 的纪元基线从 0 起算、seed 后仍做失配复位——对它无害（压缩后重发公告本就是正确行为）。本策略首求值（含重启恢复）把 `lastCompactionGeneration` 基线定为**当前值**，否则重启已压缩会话时 generation 失配会把 seed 置位的标志误复位 → warn 重发。
- 与 external-tools 策略的差异点（实现时注意）：
  1. 门控从「curTurn===0 每纪元一次」改为「两级窗口 + 每 run 每级一次」；
  2. 复位增加 run 边界（curTurn===0）；
  3. seed-scan 只扫当前 run（`loop.runs` 末尾）而非全部 run；
  4. 两个标记（seed-scan 区分两级）。
- 子代理接线：`NovelSubagent.ts` 建 `nudgeCatalog = new Map([["max_turn", () => new MaxTurnNudgePolicy()]])` 传 AgentAssembler。
- 单测文件：`core/src/runtime/nudge/__tests__/max-turn-nudge.test.ts`（对齐 external-tools-nudge.test.ts 的 makeLoop/makeRun 模式）。

## 9. 实施步骤

1. `definitions/max-turn.ts`：双标记 + `DEFAULT_WARN_WINDOW` + `renderMaxTurnText` / `renderMaxTurnFinalText` + `MaxTurnNudgePolicy`（含纪元基线修复）。
2. `__tests__/max-turn-nudge.test.ts`：覆盖 §6 验收 1-9 + 渲染纯函数 + 子代理典型窗口（maxTurn=20）用例。
3. 全 agent 接线（7 处）：`NovelAgent.ts` catalog、`NovelAgentDefinition.ts` / `ProjectImporterAgentDefinition.ts` / `BookAnalystAgentDefinition.ts` enabled、`BookAnalystAgent.ts` catalog、`NovelSubagent.ts` 子代理 catalog、`NovelExplorerAgentDefinition.ts` / `NovelComposeAgentDefinition.ts` enabled 声明。
4. 装配级断言（`novel-agent.test.ts` 接线断言扩 + 子代理/BookAnalyst 装配断言）。
5. 全量单测 + typecheck + CI 校验；回填 §11 落地记录。

## 10. v0.1 → v0.2 变更记录（评审驱动）

| # | 变更 | 理由 |
| --- | --- | --- |
| 1 | 单级提醒 → 两级递进（warn + final） | 单级防不住最坏失败模式：最后一轮仍发 tool_call → 循环退出抛异常。final 级（remaining=1 强提醒"不要再调工具"）使模型服从时走 final 分支**正常收口**，异常根本不发生（`AgentLoop.ts:449-466` 收尾分支结构） |
| 2 | 剩余轮次口径明确为"含本轮" | v0.1 文案"剩余 X 轮"有歧义（是否含本轮响应）；明确后 warn/final 窗口语义自洽 |
| 3 | 同轮双门只注 final | `maxTurn=1` 时两级同轮同时满足，叠加两条消息是噪音 |
| 4 | 补 F7 wire 归一化 / UI / 静态段说明 | `62eef76d` 已把流内 system 统一转译为 user + `<system-reminder>`，覆盖全部 nudge 源——不写明实现者可能重复造轮子或担心注入形态 |
| 5 | 非目标增加"不软化熔断路径"并说明理由 | final 级已转化大部分场景；异常对不服从场景是有效信号，软化属过度设计 |
| 6 | O4 子代理升级为最高优先级后续项 | SubagentRuntime 耗尽 = 子代理成果整个丢失，final 级对其价值高于主 agent |
| 7 | 验收标准从 10 条扩到 11 条 | 补 final 级 / 两级共存 / 塌缩边界 / 渲染纯函数用例 |

### v0.2 → v0.3（用户评审定稿：所有 agent 生效）

| # | 变更 | 理由 |
| --- | --- | --- |
| 1 | 生效范围从「仅主 agent」扩为全部 5 个 agent + resume 通道 | 用户定稿；子代理耗尽 = 成果整个丢失，final 级对其价值高于主 agent（原 O4 论证） |
| 2 | F8 装配改写为五 agent 装配矩阵 | 调研发现三条装配路径（buildNovelAgent 共用 / BookAnalyst 自有 / NovelSubagent 无 catalog 需新建），接线明细落表 |
| 3 | 子代理侧三个设计说明入 F9（live-only 兼容 / 每任务新实例 / 窗口适配） | 子代理 loop 一次性 + 不落 journal，与主 agent 生命周期差异需要显式交代 |
| 4 | O3/O4 从开放问题移除并并入正文 | 已随生效范围定稿解决 |

## 11. 实施落地记录（定稿后补）

- （实现后回填：实施偏差 / 文案定稿 / 测试实际例数。）
