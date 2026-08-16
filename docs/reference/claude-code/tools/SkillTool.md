# SkillTool

- **工具名**: `Skill`（userFacingName: 未显式定义，buildTool 默认回退为 name，即 `Skill`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/SkillTool/`
- **门槛**: 无条件（直接静态 import 并直接列入 getAllBaseTools）
- **性质**: isConcurrencySafe / isReadOnly 未定义（默认 false）

## 描述（模型侧 desc）

`description` 为动态函数（SkillTool.ts 内联）：

```
async ({ skill }) => `Execute skill: ${skill}`
```

模型侧 prompt（`prompt: async () => getPrompt(getProjectRoot())`，prompt.ts，memoize 缓存；`${COMMAND_NAME_TAG}` 已替换为 `<command-name>`）：

```
Execute a skill within the main conversation

When users ask you to perform tasks, check if any of the available skills match. Skills provide specialized capabilities and domain knowledge.

When users reference a "slash command" or "/<something>" (e.g., "/commit", "/review-pr"), they are referring to a skill. Use this tool to invoke it.

How to invoke:
- Use this tool with the skill name and optional arguments
- Examples:
  - `skill: "pdf"` - invoke the pdf skill
  - `skill: "commit", args: "-m 'Fix bug'"` - invoke with arguments
  - `skill: "review-pr", args: "123"` - invoke with arguments
  - `skill: "ms-office-suite:pdf"` - invoke using fully qualified name

Important:
- Available skills are listed in system-reminder messages in the conversation
- When a skill matches the user's request, this is a BLOCKING REQUIREMENT: invoke the relevant Skill tool BEFORE generating any other response about the task
- NEVER mention a skill without actually calling this tool
- Do not invoke a skill that is already running
- Do not use this tool for built-in CLI commands (like /help, /clear, etc.)
- If you see a <command-name> tag in the current conversation turn, the skill has ALREADY been loaded - follow the instructions directly instead of calling this tool again
```

## Input Schema

- `skill` (string, 必填): "The skill name. E.g., \"commit\", \"review-pr\", or \"pdf\""
- `args` (string, 可选): "Optional arguments for the skill"

## 附加模型侧内容（如有）

user-invocable skills 列表以 system-reminder 附件随会话下发（来源：`vendor/claude-code/src/utils/messages.ts` `skill_listing` 分支 + `SkillTool/prompt.ts` 的 `formatCommandsWithinBudget`）。消息包装格式：

```
The following skills are available for use with the Skill tool:

- {skill name}: {description - whenToUse}
...
```

每行格式为 `- ${cmd.name}: ${description}`（有 `whenToUse` 时为 `description - whenToUse`）。预算规则：skill 列表占上下文窗口 1%（`SKILL_BUDGET_CONTEXT_PERCENT`，字符预算可由 `SLASH_COMMAND_TOOL_CHAR_BUDGET` 覆盖，默认回退 8000 字符）；超预算时 bundled skills 保留完整描述，其余按均分预算截断描述（低于 20 字符时只列名字）；单条描述硬上限 `MAX_LISTING_DESC_CHARS = 1536`。
