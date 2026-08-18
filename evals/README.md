# @novel/evals —— Agent 能力评测框架

设计文档：`docs/PRD/eval-harness.md`；书库真实评测扩展（静态夹具 + mock 引擎 +
执行护栏 + 预置上下文短跑）：`docs/PRD/evals-书库真实评测.md`。两层接口：
`evalCase(input).run()` 纯采集 `(input) → { turns, toolErrors, usage, times }`，
链式断言在其上叠加；底座 evalite（可替换壳）。
三层评测：Tier 0 确定性快照（无 LLM）／密闭自测（stub provider）／Tier 2 真实评测（live API）。

## 命令

均以仓库根为工作目录。

| 命令 | 作用 | 需 API key |
| --- | --- | --- |
| `pnpm --filter @novel/evals test` | Tier 0 快照回归 + Runner/DSL 密闭自测 + case 结构自测 + 书库桩/护栏/preset 闭环（秒级，CI 可跑） | 否 |
| `pnpm --filter @novel/evals typecheck` | src + cases + evalite.config 全量 noEmit 类型检查 | 否 |
| `pnpm --filter @novel/evals build` | tsc 构建到 dist | 否 |
| `pnpm --filter @novel/evals fixture:build -- <book.txt> <别名> [--force] [--title 书名]` | 构建书库夹具包解析层（确定性免 key）+ 缺件补模板 + 构建期校验（ground-truth pid / entities 落库形状）；幂等（source 哈希一致跳过） | 否 |
| `pnpm --filter @novel/evals dev` | evalite watch：改 case 即重跑 + 本地 UI（http://localhost:3006），迭代语料用 | 是 |
| `pnpm --filter @novel/evals suite -- --tag baseline` | 跑全套件一次：`run-once-and-exit`，落盘 `results/<时间戳>-baseline/` | 是 |
| `pnpm --filter @novel/evals compare -- results/<A> results/<B>` | 基线对比：逐 case delta 表 + 红线判定，报告写 `<B>/compare.md`；**触发红线时退出码 1**（可作门禁） | 否 |
| `pnpm --filter @novel/evals report -- results/<目录>` | 为既有运行目录渲染自包含可视化报告 `report.html`（suite 结束时也会自动生成） | 否 |

常用变体：

```bash
# 只跑单个 case（evalite 按文件过滤；dev 同理可加文件参数）
pnpm --filter @novel/evals exec evalite cases/01.character-create.eval.ts

# 只重跑/更新某类测试（Tier 0 快照在有意改动 prompt/schema 后更新金样）
pnpm --filter @novel/evals exec vitest run src/snapshot.test.ts -u

# 对比两次套件结果（示例：改动前 baseline vs 改动后 candidate）
pnpm --filter @novel/evals compare -- results/2026-08-17T10-00-00-baseline results/2026-08-17T12-00-00-candidate
```

## 环境变量（Tier 2 真实评测）

| 变量 | 缺省 | 说明 |
| --- | --- | --- |
| `NOVEL_EVAL_API_KEY` | 回退 `NOVEL_PROVIDER_API_KEY` → `ANTHROPIC_AUTH_TOKEN` | API key（缺失时 runAgent 直接抛错，不静默跳过） |
| `NOVEL_EVAL_BASE_URL` | `https://api.deepseek.com/v1` | OpenAI 兼容 endpoint（评测固定走 `type:"openai"` 适配器） |
| `NOVEL_EVAL_MODEL` | `deepseek-v4-flash` | 被测模型（经 `SamplingConfig.model` 传入） |
| `NOVEL_EVAL_JUDGE_MODEL` | 同 `NOVEL_EVAL_MODEL` | `finalReplyJudge` 判定模型（可与会话模型不同） |

## case 级配置（`EvalInput` 字段）

| 字段 | 类型 / 缺省 | 说明 |
| --- | --- | --- |
| `task` | `string \| string[]`（必填） | 用户消息；数组第二条起为 follow-up（多轮指令） |
| `seed.novel` | `readonly NovelMutation[]` | 预置实体（用 `cases/seeds.ts` 构建器；形状合法性由结构自测锁死） |
| `seed.files` | `Record<string, string>` | 预置工作区文件（相对路径 → 内容） |
| `sampling` | `Partial<SamplingConfig>`，缺省 `{ model: NOVEL_EVAL_MODEL, temperature: 0 }` | 采样覆盖（maxTokens/thinking 按需） |
| `budget.maxTurns` | `30` | 每 run 最大 turn 数（撞顶 run 失败，`ok:false`） |
| `budget.timeoutMs` | `300_000` | 每 run 墙钟超时（`Promise.race` + `loop.stop()`） |
| `askScript` | `readonly AskQuestionAnswer[]` | AskUserQuestion 应答脚本，按提问顺序消耗；耗尽按「作者跳过」应答；`selections:[] + text` 为合法自由文本答案 |
| `approvals` | `"auto"` | 全放行；`{ deny: ["NovelWrite"] }` 对含拒绝工具的审批批次拒绝 |
| `library.book` | — | 书库夹具别名：经桩 deps 装配真 LibraryRead 工具壳（书单/护栏语义复刻生产；缺夹具构造期报错不静默跳过） |
| `library.mock` | — | 服务层 mock 脚本（三态：静态查询缺省 / 脚本序列含错误注入 / 状态函数常驻——队列末位函数耗尽后复用） |
| `guards.allowedTools` | — | 声明即启用意外工具护栏（allowlist 外调用硬停，`ok:false` + `abort.rule` 归因） |
| `guards.callSequence` | — | 顺序护栏：`{expect, mode:"strict"|"loose"}`（strict 跳步/耗尽后调用违规；loose 期望子序列、越序违规） |
| `guards.argsGuard` | — | 参数护栏：返回违规描述即硬停（soft 档不设护栏、让真实校验自然报错配自愈断言） |
| `guards.loopDetect` | `{maxRepeats:3}` | 连续同名同参 ≥ N 次硬停（声明即启用） |
| `preset.messages` | — | 预置会话史（简化格式 `{role:"user"\|"assistant"\|"tool", forCall, …}` 或 raw LLMessage[]）；配合 `budget.maxTurns=1–5` 即短跑 |
| `repeats` | `3` | 重复次数（evalite `trialCount` 原生重复采样） |
| `.threshold(ratio)`（DSL 方法） | `1.0` | case 级 passRate 阈值；含 judge 或高方差 case 建议 `2/3` |

metrics 扩展：`libraryCalls`（书库调用轨迹，含 `returnedParagraphIds` 证据链）、
`citations { cited, valid }`（最终回复 pid 引用与其中实际返回过的——引用有效率）、
`abort { rule, detail, turn, toolCall }`（护栏终止归因）、`scriptExhausted`（mock 脚本
耗尽回退静态次数）。断言辅助（`custom(fn)` 包装，`src/assertions.ts`）：
`expectToolCalls([{tool, args}], {mode:"subset"|"sequence"})`（缺省 subset 宽松）、
`expectedAbort(rule?)`（负向：期望违规如期发生即通过）、`returnedParagraphIds(m)`、
`toolArgsJudge(tool, rubric, {reference})`（工具参数作 judge 载荷，多次调用取最差）；
`finalReplyJudge` 增 `reference` 参考原文（判贴合/合理/不照抄，非标准答案）。

## 套件级配置（`evalite.config.ts`）

| 项 | 当前值 | 说明 |
| --- | --- | --- |
| `testTimeout` | `600_000` | 单测试超时（evalite 缺省 30s 远不够 agent 多 turn 长任务） |
| `maxConcurrency` | `2` | case 间并发（防限流） |

## 书库夹具（fixtures/books/，docs/PRD/evals-书库真实评测.md）

一书一目录 `fixtures/books/<别名>/`：`source.txt`（真实书 gitignore 不入库；
合成书 `ywjs`《雨夜旧事》随仓库提交）、`book.json`（确定性解析层：卷章骨架 +
分段清单，pid 契约 `<别名>-p<6位>`）、`fabricated/`（自造产物冻结：style.md /
excerpts.md / entities.json 种子 mutation）、`ground-truth.json`（探针锚点：伏笔对 /
矛盾对 / 单分段细节 / 人物事实 / 章节弧线）。构建期校验 ground-truth pid 存在性
与 entities 落库形状；夹具根可经 `NOVEL_EVAL_FIXTURES` 覆盖（密闭测试用）。

```bash
# 接入一本真实书：放 txt → 构建 → 手填 fabricated/ 与 ground-truth（模板已生成）
pnpm --filter @novel/evals fixture:build -- path/to/book.txt mybook --title 书名
# source 变更后强制重建解析层（作者产物保留；pid 编号变了会触发 ground-truth 校验报错）
pnpm --filter @novel/evals fixture:build -- path/to/book.txt mybook --force
```

## 运行产物（`evals/results/`，gitignored）

```
results/<时间戳>-<tag>/
├── evalite.json   # 完整运行数据（逐 trial 的 output=EvalRunMetrics、逐断言 score/metadata）
├── manifest.json  # 归因：git SHA/branch、prompt 渲染 sha256、tool schema sha256、
│                  #   model+采样、judge 模型、case 集文件清单与 hash
├── report.html    # 可视化报告（suite 自动生成，也可用 report 命令补生成）：
│                  #   单文件零依赖、离线可看，风格对齐 docs/design/app-redesign-demo.html，
│                  #   含四主题切换与 case 筛选，全量 trial 细节内嵌
└── compare.md     # compare 命令产物：delta 表 + 红线结论
```

compare 红线（退出码 1）：① 某 case passRate 降幅 >10pp；② 基线为 0 而候选出现 ≥2 次
`TOOL_ARGUMENTS_INVALID`（schema/desc 改坏的直接信号）。

## 写一个 case

规格与注册分离：`*.case.ts` 导出纯 `CaseSpec`（核心资产，结构自测消费）；`*.eval.ts` 只做一行注册（evalite 发现与运行用）。**规格文件不要 import compile/evalite**——evalite 在模块加载时即向 vitest 注册真实测试，只有 evalite 运行器才应加载注册壳。

```ts
// cases/xx.case.ts —— 规格
import type { CaseSpec } from "../src/compile.js";
import { jsonSubset } from "../src/matcher.js";
import { listOf } from "../src/snapshot-view.js";

export const spec: CaseSpec = {
  name: "my-case",
  input: { task: "……", repeats: 3, seed: { novel: [/* NovelMutation[] */] } },
  configure: (b) => b
    .toolHasCalled("NovelWrite")
    .anyToolError({ code: "TOOL_ARGUMENTS_INVALID", max: 0 })
    .toolArgs("NovelWrite", jsonSubset({ kind: "character", values: [{ name: "林默" }] }))
    .toolResponse("NovelWrite", jsonSubset({ items: [{ status: "applied" }] }))
    .store((s) => listOf(s.characters).length > 0),
};

// cases/xx.eval.ts —— 注册壳
import { defineCase } from "../src/compile.js";
import { spec } from "./xx.case.js";
defineCase(spec);
```

断言词表（16 方法）与 matcher 见 PRD §3.4–§3.7；终态快照空安全读取用
`src/snapshot-view.ts` 的 `listOf / outlineUnits / publicationOf`；单跑调试：
`const b = defineCase(spec)` 后 `await b.run()`（走 Runner 全链路，含 repeats 聚合）。

## 回归流程（改动 prompt / tool schema / desc 后）

1. `pnpm --filter @novel/evals test` —— 快照 diff 确认「改了什么」（有意则 `vitest -u` 更新金样并随 PR review）。
2. 改动前已跑 `suite -- --tag baseline`；改动后 `suite -- --tag candidate`。
3. `compare -- results/<baseline> results/<candidate>` —— 量化影响面；红线即回归，可作合并门禁（退出码）。
