# WorkflowTool

- **工具名**: `Workflow`（userFacingName: 未定义——wiring.ts 的 buildTool 未设置）
- **源码**: `vendor/claude-code/src/workflow/wiring.ts`（`createWorkflowToolCore()`；核心描述与 schema 在 `vendor/claude-code/packages/workflow-engine/src/tool/WorkflowTool.ts` 与 `tool/schema.ts`）
- **门槛**: `feature('WORKFLOW_SCRIPTS')`
- **性质**: 非只读（isReadOnly: false）、并发安全（isConcurrencySafe: true）

## 描述（模型侧 desc）

来源：`packages/workflow-engine/src/tool/WorkflowTool.ts`。`description()` 返回：

```text
Execute a workflow script that orchestrates multiple subagents to complete a task
```

`prompt()` 返回 `WORKFLOW_TOOL_PROMPT` 常量：

```text
Use the Workflow tool to execute a workflow script that orchestrates multiple subagents deterministically. The script runs in the background; you receive a run_id immediately and are notified on completion.

Provide the script inline via "script", or reference a named workflow via "name" (resolved from .claude/workflows/), or an existing file via "scriptPath". Pass "args" as a real JSON value (object/array/string), not a stringified string.

Use "resumeFromRunId" to resume a prior run — completed agent() calls replay from the journal instantly.

Concurrency: default is 3 (hard ceiling 16). OMIT maxConcurrency to use 3. To set maxConcurrency to ANY value other than 3, you MUST first ask the user via AskUserQuestion — propose 3 / 6 / 9 (or other tiers matching the fan-out width) with 3 marked "(Recommended)". The ONLY exception: the user has ALREADY specified a concurrency number in this session ("use 6", "maxConcurrency 9") — then honor it without re-asking. Never silently raise concurrency above 3 just because the workflow fans out; 3 is the recommended default.

Script execution model (common pitfalls — getting these wrong is the #1 cause of script errors): the script is the body of `new AsyncFunction` — NOT an ESM module, and TypeScript is NOT transpiled. Therefore:
- Do NOT use `import` — `agent`, `parallel`, `pipeline`, `phase`, `log`, `workflow`, `args`, and `budget` are injected as parameters; reference them directly.
- Do NOT use TS type annotations, `interface`, `enum`, `as`, or generics — the engine does not transpile, so even a .ts file with type syntax fails to parse.
- Keep EXACTLY ONE `export const meta = {...}` (plain literal) and remove every other `export` / `export default`.
- Return the result with a top-level `return`.
Prefer .js / .mjs. See /ultracode for the full playbook and quality patterns.
```

## Input Schema

来源：`packages/workflow-engine/src/tool/schema.ts` 的 `workflowInputSchema`（全部字段可选）：

- `script` (string, 可选): "Self-contained workflow script source (inline)"
- `name` (string, 可选): "Named workflow, resolved to .claude/workflows/<name>.ts|js|mjs"
- `scriptPath` (string, 可选): "Absolute path to an existing script file"
- `args` (unknown, 可选): "The args global variable passed through to the script. Pass a real JSON value (object/array/string), not a JSON string."
- `resumeFromRunId` (string, 可选): "Resume the specified run, replaying the journal"
- `description` (string, 可选): "A short description of this invocation (3-5 words)"
- `title` (string, 可选): "Progress viewer title"
- `maxConcurrency` (number, 可选, int, min 1 / max 16): "Concurrency cap for agent(). Defaults to 3 (max 16). When the workflow contains heavy parallel/pipeline fan-out, you may confirm the desired concurrency with the user via AskUserQuestion before launching."
