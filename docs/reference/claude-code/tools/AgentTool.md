# AgentTool

- **工具名**: `Agent`（userFacingName: 动态——默认 `Agent`；`subagent_type` 为 `worker` 时显示 `Agent`，为其他非 general-purpose 类型时显示 `subagent_type` 本身）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/AgentTool/`
- **门槛**: 无条件（`getAllBaseTools` 首位；另有 legacy wire name 别名 `Task`，用于权限规则/hook/续会话兼容）
- **性质**: isReadOnly: `true`（注释 "delegates permission checks to its underlying tools"）；isConcurrencySafe: `true`
- **别名**: `['Task']`；searchHint: `'delegate work to a subagent'`

## 描述（模型侧 desc）

`description()` 返回固定短句：`Launch a new agent`。完整 prompt 由 `prompt.ts` 的
`getPrompt(agentDefinitions, isCoordinator, allowedAgentTypes)` 动态拼装（工具列表按
`buildTool({ prompt })` 过滤后传入），拼装规则：

- **coordinator 模式**（`COORDINATOR_MODE` feature 开启且 `CLAUDE_CODE_COORDINATOR_MODE` 环境变量为真）：只返回下方 `shared` 段；
- **非 coordinator**：`shared` + `whenNotToUse` + `Usage notes`（各段受 feature 开关/订阅类型/进程环境拼接）；
- fork 子代理 gate 开启（`isForkSubagentEnabled()`）时：`whenNotToUse` 段整段省略，替换为 fork 版提示并在末尾追加 "## When to fork" 与 "## Writing the prompt" 两段。

以下为按「默认基线配置」（fork gate 关、agent 列表内联、非嵌入式搜索工具、非 pro 订阅、
后台任务未禁用、非 teammate、非 ant 用户）拼装后的最终文本（变量已替换为
`Agent`/`Read`/`Glob`/`SendMessage`；`<agent 列表>` 处按运行环境的 agentDefinitions 逐行生成，
格式 `- <agentType>: <whenToUse> (Tools: <tools 列表>)`）：

```
Launch a new agent to handle complex, multi-step tasks autonomously.

The Agent tool launches specialized agents (subprocesses) that autonomously handle complex tasks. Each agent type has specific capabilities and tools available to it.

Available agent types and the tools they have access to:
- <agentType>: <whenToUse> (Tools: <tools 列表，按 allowlist/denylist 过滤后输出>)

When using the Agent tool, specify a subagent_type parameter to select which agent type to use. If omitted, the general-purpose agent is used.

When NOT to use the Agent tool:
- If you want to read a specific file path, use the Read tool or the Glob tool instead of the Agent tool, to find the match more quickly
- If you are searching for a specific class definition like "class Foo", use the Glob tool instead, to find the match more quickly
- If you are searching for code within a specific file or set of 2-3 files, use the Read tool instead of the Agent tool, to find the match more quickly
- Other tasks that are not related to the agent descriptions above


Usage notes:
- Always include a short description (3-5 words) summarizing what the agent will do
- Launch multiple agents concurrently whenever possible, to maximize performance; to do that, use a single message with multiple tool uses
- When the agent is done, it will return a single message back to you. The result returned by the agent is not visible to the user. To show the user the result, you should send a text message back to the user with a concise summary of the result.
- You can optionally run agents in the background using the run_in_background parameter. When an agent runs in the background, you will be automatically notified when it completes — do NOT sleep, poll, or proactively check on its progress. Continue with other work or respond to the user instead.
- **Foreground vs background**: Use foreground (default) when you need the agent's results before you can proceed — e.g., research agents whose findings inform your next steps. Use background when you have genuinely independent work to do in parallel.
- To continue a previously spawned agent, use SendMessage with the agent's ID or name as the `to` field. The agent resumes with its full context preserved. Each Agent invocation starts fresh — provide a complete task description.
- The agent's outputs should generally be trusted
- Clearly tell the agent whether you expect it to write code or just to do research (search, file reads, web fetches, etc.), since it is not aware of the user's intent
- If the agent description mentions that it should be used proactively, then you should try your best to use it without the user having to ask for it first. Use your judgement.
- If the user specifies that they want you to run agents "in parallel", you MUST send a single message with multiple Agent tool use content blocks. For example, if you need to launch both a build-validator agent and a test-runner agent in parallel, send a single message with both tool calls.
- You can optionally set `isolation: "worktree"` to run the agent in a temporary git worktree, giving it an isolated copy of the repository. The worktree is automatically cleaned up if the agent makes no changes; if changes are made, the worktree path and branch are returned in the result.
```

**条件拼接段（按源码顺序，逐字）**：

1. 若 `shouldInjectAgentListInMessages()` 为真（GrowthBook flag `tengu_agent_list_attach`，
   可用 `CLAUDE_CODE_AGENT_LIST_IN_MESSAGES=true/false` 覆盖），agent 列表内联段替换为：

   ```
   Available agent types are listed in <system-reminder> messages in the conversation.
   ```

2. 若 ant 构建嵌入了 bfs/ugrep 搜索工具（`hasEmbeddedSearchTools()`），
   `whenNotToUse` 段中的 `the Glob tool` 分别替换为 `` `find` via the Bash tool ``（读路径）与
   `` `grep` via the Bash tool ``（内容搜索）。

3. `whenNotToUse` 段仅在不开启 fork gate 时输出（fork 开启时整段省略）。

4. 后台任务未禁用（`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` 未设真）且非 in-process teammate 时，
   "To continue a previously spawned agent" 之前插入：

   ```
   - You can optionally run agents in the background using the run_in_background parameter. When an agent runs in the background, you will be automatically notified when it completes — do NOT sleep, poll, or proactively check on its progress. Continue with other work or respond to the user instead.
   - **Foreground vs background**: Use foreground (default) when you need the agent's results before you can proceed — e.g., research agents whose findings inform your next steps. Use background when you have genuinely independent work to do in parallel.
   ```

5. 若订阅类型为 `pro` 且列表内联，第 2 条并发建议省略；否则追加：

   ```
   - Launch multiple agents concurrently whenever possible, to maximize performance; to do that, use a single message with multiple tool uses
   ```

6. fork gate 开启时，`shared` 段末句追加（接在 "is used." 之后）：

   ```
    Set `fork: true` to fork from the parent conversation context, inheriting full history and model.
   ```

   且第 5 条 bullet 后半句变为 `Each non-fork Agent invocation starts without context — provide a complete task description.`；
   第 7 条 bullet 末尾 `, since it is not aware of the user's intent` 省略。

7. ant 用户（`process.env.USER_TYPE === 'ant'`）时，isolation bullet 后追加：

   ```
   - You can set `isolation: "remote"` to run the agent in a remote CCR environment. This is always a background task; you'll be notified when it completes. Use for long-running tasks that need a fresh sandbox.
   ```

8. in-process teammate 上下文时追加：

   ```
   - The run_in_background, name, team_name, and mode parameters are not available in this context. Only synchronous subagents are supported.
   ```

   teammate（非 in-process）时追加：

   ```
   - The name, team_name, and mode parameters are not available in this context — teammates cannot spawn other teammates. Omit them to spawn a subagent.
   ```

9. fork gate 开启时，末尾追加：

   ```

   ## When to fork

   When you need to delegate work that benefits from full conversation context (e.g., continuing a multi-file refactor where the child needs the same system prompt and history), use `fork: true`. For most tasks, prefer specialized agent types (Explore, Plan, general-purpose).

   **Don't peek.** The tool result includes an `output_file` path — do not Read or tail it unless the user explicitly asks for a progress check. You get a completion notification; trust it.

   **Don't race.** After launching, you know nothing about what the fork found. Never fabricate or predict fork results. If the user asks a follow-up before the notification lands, tell them the fork is still running.

   **Writing a fork prompt.** Since the fork inherits your context, the prompt is a *directive* — what to do, not what the situation is. Be specific about scope. Don't re-explain background.
   ```

   fork gate 开启时，`Writing the prompt` 段首行前缀为
   `When spawning an agent without \`fork: true\`, it starts with zero context. `，
   且第 3 段句首为 `For non-fork agents, terse`；未开启时无前缀、句首为 `Terse`：

   ```

   ## Writing the prompt

   [When spawning an agent without `fork: true`, it starts with zero context. ]Brief the agent like a smart colleague who just walked into the room — it hasn't seen this conversation, doesn't know what you've tried, doesn't understand why this task matters.
   - Explain what you're trying to accomplish and why, what you've already learned or ruled out, and enough context for the agent to make judgment calls.
   - If you need a short response, say so ("report in under 200 words").
   - Lookups: hand over the exact command. Investigations: hand over the question — prescribed steps become dead weight when the premise is wrong.

   [For non-fork agents, terse | Terse] command-style prompts produce shallow, generic work.

   **Never delegate understanding.** Don't write "based on your findings, fix the bug" or "based on the research, implement it." Write prompts that prove you understood: include file paths, line numbers, what specifically to change.
   ```

## Input Schema

模型可见 schema = `fullInputSchema()` 按 feature 裁剪：`KAIROS` 未开启时去掉 `cwd`；
后台任务被禁用或 fork gate 开启时去掉 `run_in_background`。

- `description` (string, 必填): "A short (3-5 word) description of the task"
- `prompt` (string, 必填): "The task for the agent to perform"
- `subagent_type` (string, 可选): "The type of specialized agent to use for this task"
- `model` (enum `sonnet|opus|haiku`, 可选): "Optional model override for this agent. Takes precedence over the agent definition's model frontmatter. If omitted, uses the agent definition's model, or inherits from the parent."
- `run_in_background` (boolean, 可选): "Set to true to run this agent in the background. You will be notified when it completes."
- `name` (string, 可选): "Name for the spawned agent. Makes it addressable via SendMessage({to: name}) while running."
- `team_name` (string, 可选): "Team name for spawning. Uses current team context if omitted."
- `mode` (enum `PERMISSION_MODES` = `acceptEdits|bypassPermissions|default|dontAsk|plan|auto`, 可选): "Permission mode for spawned teammate (e.g., \"plan\" to require plan approval)."
- `isolation` (enum `worktree`（ant 用户为 `worktree|remote`）, 可选):
  - ant 用户: "Isolation mode. \"worktree\" creates a temporary git worktree so the agent works on an isolated copy of the repo. \"remote\" launches the agent in a remote CCR environment (always runs in background)."
  - 非 ant 用户: "Isolation mode. \"worktree\" creates a temporary git worktree so the agent works on an isolated copy of the repo."
- `cwd` (string, 可选, 仅 `KAIROS` feature 开启时出现在模型可见 schema): "Absolute path to run the agent in. Overrides the working directory for all filesystem and shell operations within this agent. Mutually exclusive with isolation: \"worktree\"."
