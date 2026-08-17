# eval-harness PRD —— Agent 能力评测框架：两层接口 + evalite 底座 + 三层评测体系

> 状态：📋 设计评审中（接口与底座决策已对齐，未实施）
> 关联：[`产品总览.md`](./产品总览.md)；[`context-compact.md`](./context-compact.md)（Tier 1 回放覆盖其长链路回归）

---

## 1. 背景与目标

- 现状缺口：tool desc/schema 与 system prompt 的任何改动目前没有安全网——无法回答「模型还能否正确选工具、传对参数、把结果写进 store」，也没有任何过程指标（turn 次数、工具失败次数、写入结果）被系统性记录。仓库内无 eval runner、无 case 语料、无打分与基线对比、无 CI。
- 三个目标：
  1. **能力验证**：真实模型下验证全部工具的 desc/schema 实际可用——选对工具、参数合法、失败可自愈；
  2. **回归检测**：system prompt / tool schema / desc 改动前后，量化测试结果的变化；
  3. **过程记录**：每次评测落盘 turns / tool errors / usage / times / 终态写入结果。
- 覆盖面（首期）：主 agent 的 27 个工具中挑高频与高风险链路共 15 个 case；判定以确定性断言为主（终态 + 过程指标），`finalReplyJudge` 提供 LLM-as-judge 补充形态（按需启用，见 §3.7）。

## 2. 设计原则：两层接口 + 核心资产可替换壳

- **第一层（采集）**：`(input) → { turns, toolErrors, usage, times, ... }`——一个输入进、一份指标出，零概念负担。
- **第二层（断言）**：链式 builder 叠在同一份指标上：`.toolHasCalled(...).anyToolError(...).toolResponse(...)`——断言只是对指标的声明式约束。
- **分层资产观**（决定依赖边界）：
  - **核心层（自研、稳定不换）**：`evalCase` DSL、`EvalRunMetrics` 指标结构、Runner（agent 装配 / 种子 / 轨迹采集）、结果 JSON 与 compare；
  - **壳层（可替换）**：运行器 / UI / watch。首期用 evalite；若停更或需求超出，换自研 vitest 跑法或 promptfoo 时 **case 语料与 DSL 零改动**。
- 断言 DSL 与轨迹采集是产品特定资产，没有任何第三方库认识我们的工具轨迹——这两块无论选什么底座都必须自研；底座只替代外围（调度、报告、展示）。

## 3. 外部接口设计（核心）

### 3.1 输入 EvalInput

```ts
interface EvalInput {
	/** 用户任务：单条消息，或多条（第二条起为 follow-up，模拟多轮指令） */
	task: string | string[];
	/** 预置状态：novel 实体（character/location/paragraph/volume/chapter/outline）+ 工作区文件 */
	seed?: { novel?: NovelSeed[]; files?: Record<string, string> };
	/** 采样覆盖；缺省 DeepSeek（OpenAI 兼容）+ temperature 最低档 */
	sampling?: Partial<SamplingConfig>;
	/** 预算：缺省 maxTurns=30、timeoutMs=300_000 */
	budget?: { maxTurns?: number; timeoutMs?: number };
	/** AskUserQuestion 应答脚本（按提问顺序返回；耗尽后返回「作者不再回答」） */
	askScript?: AskQuestionAnswer[];
	/** 审批策略：缺省 "auto" 全放行；负向 case 可对指定工具拒绝 */
	approvals?: "auto" | { deny: string[] };
	/** 重复次数：缺省 3（LLM 非确定性，统计化判定） */
	repeats?: number;
}
```

### 3.2 第一层：纯采集

```ts
const r = await evalCase({ task: "创建角色林默……用工具完成。" }).run();

r.metrics.turns        // 7 —— turn 次数（= provider call 次数）
r.metrics.toolErrors   // [{ toolName, code, message }]
r.metrics.usage        // { inputTokens, outputTokens }
r.metrics.times        // { totalMs, perTurnMs }
r.metrics.toolCalls    // 全量调用轨迹 ToolCallTrace[]
r.metrics.final        // 最终 assistant 消息文本
```

```ts
/** 单次执行的完整指标（每次 repeat 产出一条） */
interface EvalRunMetrics {
	ok: boolean;                     // 正常收尾（未超时 / 未撞 maxTurns）
	turns: number;
	toolCalls: ToolCallTrace[];
	toolErrors: ToolErrorTrace[];
	usage: { inputTokens: number; outputTokens: number };
	times: { totalMs: number; perTurnMs: number[] };
	final: string;
	storeSnapshot: NovelStoreSnapshot;   // 终态只读快照（characters/outline/paragraphs/volumes/chapters）
	files: Record<string, string>;       // 工作区终态文件内容
}

interface ToolCallTrace {
	turn: number;
	name: string;                    // "NovelCharacterWrite"
	args: unknown;                   // 已解析的 JSON 参数
	result?: string;
	error?: { code: ToolErrorCode; message: string };
	durationMs: number;
}
```

### 3.3 第二层：链式断言

```ts
const r = await evalCase({
	task: "为我的小说创建一个角色：主角叫林默，是一名剑客。用工具完成。",
})
	.toolHasCalled("NovelCharacterWrite")               // 该工具被调用过
	.toolNotCalled("AskUserQuestion")                   // 该工具从未被调用
	.toolCallCount("NovelCharacterWrite", { min: 1, max: 2 })
	.toolArgs("NovelCharacterWrite", jsonSubset({       // 参数结构检查
		values: [{ name: "林默" }],
	}))
	.toolResponse("NovelCharacterWrite", jsonSubset({  // 某工具出现 + 响应结构
		items: [{ status: "applied" }],
	}))
	.anyToolError({ code: "TOOL_ARGUMENTS_INVALID", max: 0 })  // 禁止参数错
	.turns({ max: 8 })
	.finalReplyContains("林默")
	.store((s) => s.characters.some((c) => c.name === "林默"))   // 终态写入断言
	.file("analysis.md", (text) => text.includes("林默"))         // 工作区文件断言
	.custom((m) => m.usage.outputTokens < 8000)        // 逃生舱：拿全量 metrics
	.run();
```

### 3.4 断言词表（16 方法）

| 方法 | 断言内容 | 回答什么 |
| --- | --- | --- |
| `toolHasCalled(name)` | 工具被调用过（≥1 次） | 选对工具 |
| `toolNotCalled(name)` | 工具从未被调用 | 负向约束 |
| `toolCallCount(name, {min?, max?})` | 调用次数区间 | 调用纪律 |
| `toolArgs(name, matcher)` | 该工具**某次调用**的 args 匹配（存在一次即过） | desc 是否让模型传对参 |
| `toolResponse(name, matcher)` | 该工具**某次响应**的 result 匹配 | 响应结构检查 |
| `anyToolError({code?, toolName?, min?, max?})` | 工具错误约束（max 缺省 0；min 用于失败自愈 case） | `TOOL_ARGUMENTS_INVALID`=schema 清晰度信号 |
| `turns({min?, max?})` | turn 次数 | 效率 |
| `finalReplyContains(text)` | 最终回复包含子串（传数组 = 全部包含） | 收尾质量 |
| `finalReplyRegex(re)` | 最终回复匹配正则 | 收尾质量 |
| `finalReplyFn(fn)` | 最终回复的任意谓词 | 收尾质量 |
| `finalReplyJudge(rubric, opts?)` | LLM-as-judge 按 rubric 判定最终回复（§3.7） | 回复质量主观面 |
| `store(fn)` | novel 终态（只读快照） | **最终结果是否写入成功** |
| `file(path, matcher)` | 工作区文件内容 | 文件写入 |
| `usage({maxInput?, maxOutput?})` | token 预算 | 成本护栏 |
| `custom(fn)` | 任意谓词，收 `EvalRunMetrics` | 逃生舱 |
| `threshold(ratio)` | case 级 passRate 阈值（缺省 1.0） | 容忍抖动 |

### 3.5 matcher 形态

`toolArgs` / `toolResponse` / `file` 的 matcher 三选一：

- **谓词函数**（主形态）：`(parsed) => boolean`——args 收已解析对象，result/file 收文本，表达力最强；
- **内置 helper**：`jsonSubset(shape)` 对解析后的 JSON 做「对象按键子集、数组按位子集、标量相等」的递归匹配（novel 写类工具 result 是 `{items:[{id,status,version}]}` 形 JSON 文本，适用）；`contains(s)` 子串；`regex(re)`；
- **字符串**：等价 `contains`。

### 3.6 执行语义与结果

- 断言在 `.run()` 前只是收集；执行 input（× repeats），**全部断言对每次执行的 metrics 求值，无短路**——一次运行拿到所有断言的通过情况；断言间恒为 AND。
- case 级判定 = passRate（各次执行断言全过的比例）≥ 阈值；缺省 100%，`.threshold(2/3)` 按 case 放宽（容忍 LLM 偶发抖动）。
- `.run()` 直连 Runner（单 case 调试 / 纯采集用）；套件模式下由 evalite 的 task 调用同一 Runner（见 §4.2）。

```ts
interface EvalResult {
	passed: boolean;
	runs: EvalRunMetrics[];              // 每次 repeat 的完整指标
	assertions: {                        // 断言 × 执行 矩阵
		name: string;                    //   "toolHasCalled(NovelCharacterWrite)"
		perRun: { run: number; passed: boolean; actual: string }[];
	}[];
	aggregate: { passRate: number; avgTurns: number; totalTokens: number; totalMs: number };
}
```

### 3.7 finalReply 家族与 LLM-as-judge

- 家族四方法替代此前的重载形态 `finalReply(matcher)`，语义显式化：`finalReplyContains`（子串；传数组 = 全部包含）/ `finalReplyRegex` / `finalReplyFn`（谓词收最终回复文本）/ `finalReplyJudge`（LLM-as-judge）。
- **finalReplyJudge 语义**：
  - 输入：`rubric`（自然语言判定标准）+ 可选 `opts { model?, scoreAtLeast? }`；
  - 实现：run 结束后对每次 repeat 的最终回复各发起一次 judge 调用（judge 模型独立配置，缺省同为 DeepSeek，可与 agent 模型不同）；judge 提示词为固定模板（任务原文 + 最终回复 + rubric），要求结构化输出 `{pass, score, reason}`；
  - 判定：`pass === true`（或 `score ≥ scoreAtLeast`）记过；断言矩阵的 `actual` 记 judge 的 reason（失败原因可见）；
  - 非确定性：与 repeats × passRate 天然配合——建议含 judge 断言的 case 显式 `.threshold(2/3)`；
  - 失败语义：judge 调用自身出错（网络/超时）该次断言记 error，按不过计；
  - 成本：每 repeat 一次额外 judge 调用，计入套件 token 熔断预算。
- 实现排期：确定性三方法随二期落地；`finalReplyJudge` 排二期末（接口先行占位，未实现时返回明确「未实现」错误，不静默跳过）。

## 4. 底座选型：evalite（已对齐）

### 4.1 候选对比

| 维度 | evalite（选定） | promptfoo | 全自研 |
| --- | --- | --- | --- |
| 定位 | Vitest 上的薄壳，`.eval.ts` + 本地 UI + watch | 自成体系的评测平台（CLI/配置世界/Web 查看器） | — |
| 概念模型 | `task` = 任意异步函数返回**任意 TS 对象**；scorer 收 `{input, output, expected}` | provider 产出文本 output，断言面向文本；轨迹指标需走 `metadata` 侧通道 | — |
| 类型边界 | DSL 与指标间**全程类型安全**，无序列化边界 | 断言边界处类型断开（metadata 字符串世界） | 全类型安全 |
| 白拿能力 | 运行器 / watch / 本地 UI / HTML 导出 / 失败阈值 | repeat 采样、`--compare` 基线回归表、模型×prompt 矩阵、CI 退出码 | 无 |
| 缺失能力 | 重复采样（N 条数据行模拟）、基线对比（自研薄工具） | —（功能最全） | 全部自造 |
| 依赖重量 | 小 | 大（装进来背着全部概念：redteam/prompt 管理/矩阵） | 零 |
| 成熟度风险 | 年轻（v1，单维护者）——但核心资产不依赖它，停更只损失壳 | 成熟、社区大 | 无外部风险 |

### 4.2 映射方式（与两层接口一一对应）

```ts
// 每个 case 编译为一个 evalite 评测：task = Runner，scorer = DSL 方法，data N 行 = repeats
evalite("character-create", {
	data: [input, input, input],                 // N 行 = 重复采样缺省 3
	task: async (input) => runAgent(input),      // 我们的 Runner，返回 EvalRunMetrics
	scorers: compileAssertions(dslChain),        // 链上每方法 → 一个类型化 scorer 闭包
});
```

case 级 passRate 聚合不依赖 evalite：报告层直接读每次执行的 metrics 与断言矩阵计算（口径见 §13 开放问题）。

### 4.3 替换成本论证

DSL / case 语料 / `EvalRunMetrics` / 结果 JSON / compare 全部为核心层自有资产；evalite 只出现在「把 case 注册成 `.eval.ts`」这一层。若停更：改注册层为纯 vitest `test()` 循环（或 promptfoo 的 custom provider + JS 断言），case 与断言定义不动。

## 5. 三层评测体系

| 层 | 形态 | 跑什么 | 回答什么 |
| --- | --- | --- | --- |
| **Tier 0** 确定性快照 | vitest，无 LLM，秒级 | system prompt 按 section 分块金样；全部 ToolDef 的 name+version+desc+parameters 金样；schema 自检（JSON Schema 合法性、properties 均有 description） | 「改了什么」——杜绝无意漂移，改动必须先过快照 review |
| **Tier 1** 录制回放 | mock provider，确定性 | `ProviderCallDebugger` 的 provider-calls.jsonl 回放固定应答，驱动完整 loop | loop 长链路（压缩三道门禁 / 保险丝）回归 + eval harness 自测 |
| **Tier 2** 真实评测 | live API × evalite × `evalCase` | 15 个核心 case × repeats=3 | 「改动影响了多少」——能力与回归量化 |

「prompt/schema 改动是否影响测试结果」= 两道闸：Tier 0 快照 diff（捕获改动**事实**，prompt 分节快照而非全文 hash，块级 diff 便于 review）+ Tier 2 基线 compare（量化**影响面**）。

## 6. 复用的现有基础设施（全部已核实）

- **装配入口**：`buildNovelAgent()`（`core/src/runtime/agent/NovelAgent.ts:99`）注入点即 Runner 的全部旋钮：
  - `provider`：`createProvider({type:"openai", baseUrl: DeepSeek})`，model 经 `SamplingConfig`；
  - `handle`：duck-typed `{query, mutate}` 直接盖在 `InMemoryNovelStore` 上（`core/scripts/novel-agent-smoke.mjs` 已示范此装配）；
  - `requestApproval`：**不注入时 requireApproval 工具按拒绝处理**（Write/Edit/ExitComposeMode 均需审批）——eval 必须按 `approvals` 配置注入放行/拒绝闭包；
  - `requestAsk`：AskUserQuestion 脚本应答通道；
  - `definition`：prompt 变体入口（留给 A/B 评测）；
  - `listeners` / `debugger`：轨迹采集与录制。
- **指标信号源**：`loop.run(text, {sampling, maxTurns}, onEvent)` 的 `LoopEvent` 流——`tool-call-request{name, args}` / `tool-call-response{result?, error?}`（`core/src/conversation/contract/events/output.ts`）；turns = run 内 `assistant.message` 事件计数（每次 provider call 恰产出一条）；`AgentLoopResult{final, usage}` 收尾。
- **错误码**：`ToolErrorCode` 六类（`core/src/runtime/tool/errors.ts`）——`TOOL_ARGUMENTS_INVALID`（参数 JSON/schema 违反）、`TOOL_PRECHECK_FAILED`（存在性/乐观锁/id 占用）、`TOOL_HANDLER_FAILED` 等，`anyToolError` 直接按 code 约束。
- **三个先例**：`novel-agent-smoke.mjs`（Tier 2 Runner 种子：InMemoryNovelStore + 真实 DeepSeek + 终态查询）、`core/src/runtime/agent/__tests__/agent-render-e2e.test.ts`（Tier 0 种子：stub provider 渲染全量 system prompt 断言 section 序）、`core/src/runtime/compact/__tests__/auto-compact-real.test.ts`（线协议级 SSE stub）。

## 7. Runner 装配细节

- 每次执行（每个 repeat）独立装配：临时 workspace 目录（seed 文件落盘）+ 全新 `InMemoryNovelStore`（seed 实体写入）→ 无跨 case / 跨次污染。
- 终态采集：run 结束后一次性物化 `storeSnapshot`（查询全部实体）与 `files`（读工作区文件），断言读快照而非活句柄——确定性。
- 审批 / 提问通道按 `approvals` / `askScript` 生成闭包注入。
- 并发：case 间默认并发 2（防限流）；套件级 token 预算熔断（超限中止剩余 case 并标记 skipped）。
- 采样固定并写入结果：temperature 最低档、model、maxTokens 逐 case 可覆盖——结果可归因到「model + prompt 版本 + git SHA」。

## 8. 基线对比与归因

- 每次 run 落 `results/<timestamp>/manifest.json`：git SHA、prompt 各 section 内容 hash、tool schema 整体 hash、model + sampling、case 集 hash。
- `eval:compare <baseline> <candidate>`（自研薄工具，读两份结果 JSON）：逐 case delta 表——passRate 变化、avgTurns 变化、错误码直方图变化——加套件汇总。
- 回归红线：passRate 降幅 >10pp，或出现新增的系统性 `TOOL_ARGUMENTS_INVALID`（提示 schema/desc 改坏）。

## 9. 首批 15 个 case

| # | case | 关键断言 |
| --- | --- | --- |
| 1 | 角色创建 | `toolHasCalled(NovelCharacterWrite)` + `store` 字段正确 |
| 2 | 大纲创建 | `toolArgs` 结构（story units + leaf plans） |
| 3 | 章节创建 + 段落正文写入 | ChapterWrite → ParagraphWrite 链式 |
| 4 | 读后改（预置角色） | CharacterEdit 且 `anyToolError max:0`（baseRevision 正确获取） |
| 5 | 批量地点创建 | `toolArgs` values 数组 ≥3 |
| 6 | 卷-章层级创建 | VolumeWrite + ChapterWrite |
| 7 | 删除链路 | NovelDelete + `store` 实体消失 |
| 8 | **失败自愈：stale revision** | `anyToolError({code: PRECHECK_FAILED, min:1})` + 最终 `toolResponse(applied)` |
| 9 | **失败自愈：duplicate id** | 同上模式（seed 占用目标 id） |
| 10 | 易混淆对：改一段已有正文 | `toolNotCalled(NovelChapterWrite)`（应段落级 Edit 而非整章重写） |
| 11 | 易混淆对：文档 vs 正文 | 同任务内 `file`（工作区 Write）+ `store`（ParagraphWrite）双写 |
| 12 | TodoWrite 使用 | 多步任务 `toolCallCount ≥2` 且状态推进 |
| 13 | Read/Glob 探索 | seed 工作区文件，先读后写（`toolHasCalled(Read)` 前置） |
| 14 | AskUserQuestion | 信息不足时提问，`askScript` 应答后完成（`toolHasCalled(AskUserQuestion)`） |
| 15 | 负向：compose 模式禁写 | EnterComposeMode 后 canonical 写被拒，`toolNotCalled` 硬写 |

case 8 完整示例（任务文本故意给出错误 revision，构造必然失败）：

```ts
evalCase({
	task: "把角色林默的简介改为「散人」。他当前 revision 是 3，直接基于 revision 3 改。",
	seed: { novel: [{ kind: "character", id: "char_linmo", name: "林默", revision: 1 }] },
})
	.toolHasCalled("NovelCharacterRead")                                   // 失败后应重读
	.anyToolError({ code: "TOOL_PRECHECK_FAILED", min: 1, max: 2 })        // 预期撞锁
	.toolResponse("NovelCharacterEdit", jsonSubset({ items: [{ status: "applied" }] }))
	.store((s) => s.characters.find((c) => c.id === "char_linmo")?.bio === "散人")
	.run();
```

## 10. 包结构与命令

```
evals/（新 workspace 包，依赖 @novel/core + evalite）
├── src/
│   ├── runner.ts        # runAgent：装配 buildNovelAgent + 种子 + 轨迹采集 → EvalRunMetrics
│   ├── dsl.ts           # evalCase 链式断言 + matcher helper（jsonSubset/contains/regex）
│   ├── compile.ts       # case → evalite 评测（task/scorer/data 行）注册层（可替换壳的接缝）
│   ├── compare.ts       # 基线对比薄工具
│   └── snapshot.test.ts # Tier 0 金样 + schema 自检
├── cases/               # 15 个 case 定义（进 git）
├── snapshots/           # Tier 0 金样（进 git）
└── results/             # 运行产物 + manifest（gitignore）
```

命令收敛为：`pnpm --filter evals dev`（evalite 运行器 + 本地 UI + watch）、`pnpm --filter evals test`（Tier 0 vitest）、`pnpm --filter evals compare -- <a> <b>`。

## 11. 边界与非目标

- LLM-as-judge 仅限 `finalReplyJudge`（最终回复的 rubric 判定，§3.7）；**不做**对 store 正文内容的通用 prose 质量评分、judge 模型矩阵（Braintrust autoevals 可作后续 scorer 库备选）。
- CI 集成（仓库尚无 CI，evals 成熟后再接）。
- 多模型矩阵自动跑（模型是参数，手动可跑，不做矩阵编排）。
- subagent 链路评测（Agent/TaskOutput/TaskStop）、压缩长会话的真实评测（Tier 1 回放覆盖 loop 回归即可）。
- 报告 Web UI（evalite 本地 UI + markdown/JSON 汇总够用）。

## 12. 验收标准

- [x] 本轮：PRD 评审通过，接口与底座决策对齐（2026-08-17）。
- [ ] 一期：Tier 0 快照绿——prompt 分节金样 + 27 工具 desc/schema 金样 + schema 自检，`pnpm --filter evals test` 通过。
- [ ] 二期：Runner + DSL + 15 case 在 evalite 下全部可跑，`EvalRunMetrics` 与断言矩阵落盘 results/。
- [ ] 二期（可选）：`finalReplyJudge` LLM-as-judge 可用（judge 模型独立配置，判定与 reason 落盘）。
- [ ] 三期：`eval:compare` 可用——两次 run 的 delta 表 + 回归红线判定。

## 13. 开放问题

- repeats=3 × 阈值 100% 的组合是否过脆（首批跑完后校准；case 8/9 这类失败自愈可能需 `.threshold(2/3)`）。
- DeepSeek temperature 下限的实际方差（影响重复采样稳定性）。
- case 任务文本为中文，prompt 改动是否带来表述性系统漂移（任务措辞需与 prompt 术语解耦）。
- judge 提示词模板与 rubric 措辞的判定稳定性校准（同一回复多次 judge 的翻转率）；judge 成本控制（是否对相同 (task, final) 对做缓存）。
- evalite 成熟度（v1、单维护者）与 5min 级长 task 在 watch 模式下的体验——必要时 `.run()` 直跑 + 注册层旁路。
- N 条数据行模拟重复采样的聚合口径：evalite 逐行打分，case 级 passRate 由报告层读 metrics 与断言矩阵计算——需确认 evalite 结果导出包含逐行原始数据。
