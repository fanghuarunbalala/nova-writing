# context-compact PRD —— 上下文压缩：三道门禁（结构化 → 逐段摘要 → 硬丢弃）+ 超窗保险丝

> 状态：✅ 已实施（2026-08-16：compact 链异步化 + AutoCompactPolicy 三级门禁 + CompactedEvent 发射 + 保险丝 + 恢复 run 边界重建）
> 关联：[`产品总览.md`](./产品总览.md) §4.3（压缩策略链设计意图）；[`gui-performance-2.md`](./gui-performance-2.md)（journal 压缩触发定稿：`onCompacted → writeRuns`）；技术参考 `docs/reference/claude-code/`（auto-compact / Snip 逆向资料）

---

## 1. 背景与目标

- 要解决的问题：主 agent 长会话（多轮工具 + 万字级正文生成）上下文无限增长，最终撞模型窗口上限报错；此前唯一组装点注册 `compactPolicies: []`，压缩从不发生，而 system prompt（`novel.ts:47`）早已向模型承诺"接近上限时自动压缩"。
- 本产品域的两个特有前提（决定了可以比 CC 更激进）：
  1. **聊天历史的大块内容是正式稿的冗余副本**：正文 ` ```novel ` 块、写入类工具的参数/结果在 canonical store（novel 域）都有权威版本，历史中替换为占位符近零信息损失，模型可随时查询。
  2. **关键设定不在历史里**：system prompt（含 NOVEL.md）每次调用重渲染，实体设定可查。历史中独有的是作者意图（首条 user 消息）、讨论中的决策与未落稿的伏笔。
- 目标（一句话）：任意长度会话不因上下文超窗失败；压缩自动发生、成本递进（免费规则 → LLM 摘要 → 硬丢弃），且不因压缩导致摘要失真累积。

## 2. 总体结构：三道门禁 + 一条保险丝

每次 provider call 组装时（`LoopContext.toProviderCall` 步骤①）评估，单次调用内顺序收敛：

```
est = 最近 provider 回报 inputTokens × (当前字符/信号时字符)   ← 比例重估
est ≥ 70%·window            → T1 结构化骨架化（零成本，先做）
est ≥ window−maxOutput−12k  → T2 折叠最老未摘要段为摘要 run（一次一段，≤92% 夹取）
est 仍 ≥ window−maxOutput/2 → T3 从最老开始硬丢弃整 run（含旧摘要 run）
任一级动作 → onCompacted → journal 全量重写（writeRuns）+ compacted 事件发射
```

保险丝：provider 返回 context-length 类错误（HTTP 400 + token/context 关键词）→ 无视阈值 `forceCompact`（force 模式：T2 连续折叠多段）→ 重组装请求重试一次。token 估算的一切误差最终由这条兜住。

实现形态：单一 `AutoCompactPolicy`（`runtime/compact/definitions/auto-compact.ts`）内部三级判定；`CompactPolicyChain` 机制保留给未来策略（Snip 等）。装配点：`buildNovelAgent` 以 provider 闭包构造；subagent 不接（短生命周期，MAX_RUNS 兜底）。

## 3. 阈值与信号

- **信号**：`RunContext.lastInputTokens`（每 turn 回写最近一次 provider 回报的输入 token，含 system/tools = 真实上下文占用）+ `signalChars`（信号时刻全部 run 字符量）。压缩后 est 按字符比例重估，避免"压缩完还用旧信号"的死循环。
- **窗口**：`ModelInfo.contextWindowTokens`（本次新增字段；按名启发式 claude≈200k / gpt≈400k / deepseek≈128k / 未知 128k，registry 可覆盖）；`Provider.getModelInfo(model)` 公开查询。
- **T1 = 70%·window**：结构化免费，早触发。
- **T2 = min(window − maxOutput − 12k, 92%·window)**：公式保证给本轮输出（maxOutput 可到 32k）留足空间——小说生成单 turn 输出大，固定百分比会在触发前撞窗。
- **T3 = window − maxOutput/2**：危险线，承认信息损失的最后手段。
- 无模型信号（会话首轮/纯恢复）不压缩——无压力证据不动作。

## 4. T1 结构化骨架化（压缩区规则）

分区：`首 run（作者意图）+ 压缩区 + 最近 3 run（含执行中 run，恒不触碰）`；压缩区 <1 run 时 no-op。**协议约束：tool result 只替换不删除**（与 toolCall 按 id 配对，防 provider 400）；占位文案按用户可读标准写（journal 重写后 UI 展示同款）。

通用长度规则（>阈值 → 一行中文占位）：

| 对象 | 阈值 | 占位 |
| --- | --- | --- |
| 工具结果 | >500 字符 | `[工具结果已省略：<工具名> 结果（原 N 字）]` |
| ` ```novel ` 正文块 | 恒占位 | `[正文已入档：<首行标题>]` |
| 工具参数（args） | >800 字符 | `{"_compacted":"…","ids":[…]}` |
| assistant 评述（去块后） | >1000 字符 | 头 400 + 省略标记 + 尾 200 |

novel 域规则（乐观锁感知，全部基于 args JSON 解析，不解析结果文本）：

- **写去重保最后**：Edit/Delete/Write 的 `values[].id` 提取实体 id；同实体多次写只保留**最后一次**调用记录（其超长 content 参数仍占位，正式稿为准），更早调用参数整体替换为覆盖占位。批量写按**项**归属判定：一次写 A+B、后来只重写 A，该次调用因 B 未被覆盖而保留。
- **后写覆盖前读**：read 的目标实体（顶层 `*Id` 参数）若在更晚消息中被写过（区内或保留尾区均可）→ read 结果无条件占位（留着过期内容只会误导模型）。

幂等：占位前缀即检测标记（`[工具结果已省略` / `_compacted` 等），无状态检测，跨重启成立。

## 5. T2 逐段摘要折叠（防失真不变量）

- **逐段**：每次触发只折叠**最老的未摘要段**（输入预算 ~40k token → 摘要 ≤2k token），折完 run 删除、原地留摘要 run；没折完的下次 provider call 自动续折。段字符量 <1000 不折（摘要本身有体积，得不偿失；压力来自保留区交给 T3）。
- **摘要 run**：user 角色合成消息，`<context-summary>` 内容级标记（跨重启可识别），注明覆盖的 run seq 区间；seq 经 `LoopContext.allocateSeq()` 分配（与 appendRun 同计数器）。
- **防失真三不变量**：① 摘要 run **只增不并**——永不合并旧摘要、永不再摘要已摘要内容（summary-of-summary 失真累积）；② 摘要内容携带实体 id/名称与变更要点，正文不复述（正式稿为准）；③ 检测靠内容标记而非内存 flag。
- **摘要请求**：会话当前主模型，无工具、thinking off、maxTokens 2048；system prompt 要求结构化中文输出（关键事实/已做决策/实体与正文变更/伏笔与待办，≤1500 字）。
- **降级**：摘要调用失败 → 确定性占位摘要（压缩仍发生、信息全失但不阻断）+ 日志告警。
- 历史形态演化：`[首run][S1][S2]…[骨架run…][最近3run]`——摘要带只增不并。

## 6. T3 硬丢弃

- 触发：T1+T2 之后 est 仍 ≥ 危险线（正常会话不应到达）。
- 顺序：压缩区最老开始（**含旧摘要 run**）→ 首 run（作者意图）最后；逐 run 丢弃、每次重估算、结构化日志记录。
- MAX_RUNS=50 滑动窗口维持现状，作为内存侧防溢出兜底（溢出即丢，与 T3 哲学一致）。

## 7. 事件与持久化联动

- **CompactedEvent**（type "compacted"，persist true）：AgentLoop 构造时自订阅 `onCompacted` 置 pending，`toProviderCall` 返回后/保险丝路径冲刷发射——契约早已定义，本期起有发射方。UI 投影对 compacted 无操作（事件透传留档）。
- **journal**：`JournalBridge.onCompacted → writeRuns` 全量重写为 snapshot 行（gui-performance-2 定稿，本期兑现首次真实触发）。摘要 run/骨架消息随 snapshot 持久化。
- **恢复**：journal 本就按 run 快照存储；child 入口恢复装配从"平铺为单 run"改为**透传 run 边界**（`resumeRuns` → `LoopContext.restoreRuns`，seq 对齐最大值）。否则首 run 保护会罩住全部历史、压缩链永不动作——这是恢复路径必须重建 run 结构的原因。
- **可观测性**（结构化日志，`logger` 经 buildNovelAgent 注入）：`compact.evaluated`（debug，每次评估的判定/est/t1）、`compact.trigger`（info，触发快照：force/model/window/est/三线）、`compact.t1.skeletonized` / `compact.t2.folded`（info，含 estAfter/折叠区间）、`compact.t3.dropped`（warn，逐 run）、`compact.summary_failed`（warn）、`compact.done`（info，changed/estAfter）；保险丝路径另有 `agent.call.context_length_fuse`（warn）。

## 8. 边界与非目标

- 明确不做（本期）：
  - Snip 式模型自主剪除工具 + CtxInspect 用量查看（CC `HISTORY_SNIP` 形态；链上可叠加为未来策略）。
  - 独立低成本摘要模型配置面（摘要用会话主模型）。
  - 压缩前提醒 nudge（compaction_reminder 式"重要信息及时记入正文"）。
  - 跨会话过期读精确检测（对比 read 结果内嵌 entityVersion / live 查询当前版本）——本地"后写覆盖"规则先行。
  - 单 run 自身超窗（run 内截断 / microcompact）。
  - UI 压缩提示组件（事件已发射，投影侧透传）。
- 已知代价：T2 触发 turn 的首响应增加数秒（摘要调用，CC auto-compact 同款）。

## 9. 验收标准

- [x] 单测：策略三级触发判定/分区/写去重项级归属/后写覆盖前读/占位与配对完整/逐段折叠与标记幂等/摘要失败降级/T3 丢弃顺序/force 连续折叠（`auto-compact.test.ts` 19 例）。
- [x] 集成：toProviderCall 触发压缩发射 compacted 事件；context-length 错误 → force + 重试一次成功；非超窗错误不触发保险丝；restoreRuns 边界恢复 + seq 对齐（`agent-loop-compact.test.ts` 4 例）。
- [x] 全量 core vitest 绿（536 例）；`pnpm build` 全仓通过。
- [ ] 手测冒烟（`pnpm gui:release` 长会话）：T1 触发后 journal 重写为骨架、UI 历史显示占位文案；T2 触发后摘要 run 可见；重启恢复后压缩链继续工作。

## 10. 开放问题

- T1 占位阈值（500/800/1000 字符）与 T2 段预算（40k）为工程缺省值，待真实长会话手测后校准。
- 保留尾区固定 3 run：超长单 run（如一次 run 内几十轮工具调用）可能使尾区自身超窗——与"单 run 超窗"同属后续课题。
