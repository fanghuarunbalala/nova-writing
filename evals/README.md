# @novel/evals —— Agent 能力评测框架

设计文档：`docs/PRD/eval-harness.md`。两层接口：`evalCase(input).run()` 纯采集
`(input) → { turns, toolErrors, usage, times }`，链式断言在其上叠加；底座 evalite（可替换壳）。

## 命令

| 命令 | 作用 |
| --- | --- |
| `pnpm --filter @novel/evals test` | Tier 0 快照回归 + Runner/DSL 密闭自测（无 LLM，秒级） |
| `pnpm --filter @novel/evals dev` | evalite watch + 本地 UI（http://localhost:3006），迭代 case 用 |
| `pnpm --filter @novel/evals suite -- --tag baseline` | 跑全套件，落 `results/<时间>-<tag>/{evalite.json, manifest.json}` |
| `pnpm --filter @novel/evals compare -- results/<a> results/<b>` | 基线对比报告（红线：passRate 降 >10pp / 新增系统性 TOOL_ARGUMENTS_INVALID） |

## 环境变量

| 变量 | 缺省 | 说明 |
| --- | --- | --- |
| `NOVEL_EVAL_API_KEY` | 回退 `NOVEL_PROVIDER_API_KEY` → `ANTHROPIC_AUTH_TOKEN` | API key（Tier 2 真实评测必需） |
| `NOVEL_EVAL_BASE_URL` | `https://api.deepseek.com/v1` | OpenAI 兼容 endpoint |
| `NOVEL_EVAL_MODEL` | `deepseek-v4-flash` | 被测模型 |
| `NOVEL_EVAL_JUDGE_MODEL` | 同 `NOVEL_EVAL_MODEL` | `finalReplyJudge` 的判定模型 |

## 写一个 case

```ts
// cases/xx.eval.ts
import { defineCase } from "../src/compile.js";
import { jsonSubset } from "../src/matcher.js";

defineCase(
  "my-case",
  { task: "……", repeats: 3, seed: { novel: [/* NovelMutation[] */] } },
  (b) => b
    .toolHasCalled("NovelCharacterWrite")
    .anyToolError({ code: "TOOL_ARGUMENTS_INVALID", max: 0 })
    .toolResponse("NovelCharacterWrite", jsonSubset({ items: [{ status: "applied" }] }))
    .store((s) => Array.isArray(s.characters) && s.characters.length > 0),
);
```

断言词表与 matcher 见 PRD §3.4–§3.7；单跑调试：`const b = defineCase(...)` 后 `await b.run()`。

## 回归流程（改动 prompt/schema 后）

1. `pnpm --filter @novel/evals test` —— 快照 diff 确认「改了什么」（有意则 `vitest -u` 更新金样）
2. 改动前已跑 `suite --tag baseline`；改动后 `suite --tag candidate`
3. `compare -- results/<baseline> results/<candidate>` —— 量化影响面，红线即回归
