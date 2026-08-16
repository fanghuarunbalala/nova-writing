# Claude Code `<system-reminder>` 运行时注入全集

`<system-reminder>` 是运行时**每轮/事件触发**注入消息流的文本块（不是主 system prompt 的一部分；
主 prompt 只解释这些标签的存在，见 [system-prompt.md](./system-prompt.md) §3.1 ②/§3.2）。
渲染统一经 `wrapMessagesInSystemReminder`（`src/utils/messages.ts:3489`，`<system-reminder>\n{{content}}\n</system-reminder>`）。
按注入来源分类：

## 1. 用户上下文注入（`src/utils/api.ts` `prependUserContext`）

每请求在消息流头部注入。CLAUDE.md 用高权重 `<project-instructions>`（不在这类里）；
其余上下文（记忆、`currentDate` 等）用：

```
<system-reminder>
As you answer the user's questions, you can use the following context:
# {{key1}}
{{value1}}
# {{key2}}
{{value2}}

      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.
</system-reminder>
```

（context 键来自 `getUserContext`（`src/context.ts`），含 `currentDate: "Today's date is {{localISODate}}."`、记忆、
额外上下文文件等。）

## 2. 相关记忆 surfacing（`src/utils/attachments.ts`）

每轮相关性排序后最多 5 条记忆，每条以 `<system-reminder>` 附件注入（4KB/条、20KB/轮封顶）。
头部（`memoryHeader`）：

```
Memory (saved {{age}}): {{path}}:
{{memory 内容（截断时附：> This memory file was truncated ({{limit}}). Use the Read tool to view the complete file at: {{filePath}}）}}
```

>1 天时前缀为保鲜提醒：`This memory is {{d}} days old. Memories are point-in-time observations, not live state — claims about code behavior or file:line citations may be outdated. Verify against current code before asserting as fact.`
（同一文本也用于 FileReadTool 读到记忆文件时，见 `src/memdir/memoryAge.ts`。）

## 3. 事件 attachment（`src/utils/attachments.ts` 类型定义 + `src/utils/messages.ts` 渲染）

> 补充（2026-08-16 复查）：plan mode / auto mode 家族先前遗漏，现补全（§3.1–§3.5）。

### 3.1 plan_mode（full，主 agent 5 阶段工作流，`getPlanModeV2Instructions`）

注入频率：进入 plan mode 首轮必发；之后每 `TURNS_BETWEEN_ATTACHMENTS` 个人类轮次发一次；
第 1、6、11… 次发 full，其余发 sparse。Phase 4 段有 4 个实验臂（GrowthBook `pewter_ledger` 变体：
control / trim / cut / cap）。

```
Plan mode is active. The user indicated that they do not want you to execute yet -- you MUST NOT make any edits (with the exception of the plan file mentioned below), run any non-readonly tools (including changing configs or making commits), or otherwise make any changes to the system. This supercedes any other instructions you have received.

## Plan File Info:
{{planExists ? "A plan file already exists at {{planFilePath}}. You MUST use Read to read it first before making any changes. Make incremental edits using the Edit tool — do NOT overwrite the entire file unless the user explicitly asks for a complete rewrite." : "No plan file exists yet. You should create your plan at {{planFilePath}} using the Write tool."}}
You should build your plan incrementally by writing to or editing this file. NOTE that this is the only file you are allowed to edit - other than this you are only allowed to take READ-ONLY actions.

## Plan Workflow

### Phase 1: Initial Understanding
Goal: Gain a comprehensive understanding of the user's request by reading through code and asking them questions. Critical: In this phase you should only use the Explore subagent type.

1. Focus on understanding the user's request and the code associated with their request. Actively search for existing functions, utilities, and patterns that can be reused — avoid proposing new code when suitable implementations already exist.

2. **Launch up to {{exploreAgentCount}} Explore agents IN PARALLEL** (single message, multiple tool calls) to efficiently explore the codebase.
   - For tasks with well-known file targets, 1 agent may suffice. In most cases, prefer launching 2-3 agents with complementary search focuses to maximize coverage.
   - Use multiple agents when: the scope is uncertain, multiple areas of the codebase are involved, or you need to understand existing patterns before planning.
   - Quality over quantity - {{exploreAgentCount}} agents maximum. Do NOT skip exploration — always use at least 1 Explore agent in Phase 1.
   - When using multiple agents: Provide each agent with a specific search focus or area to explore. Example: One agent searches for existing implementations, another explores related components, a third investigates testing patterns

### Phase 2: Design
Goal: Design an implementation approach.

Launch Plan agent(s) to design the implementation based on the user's intent and your exploration results from Phase 1.

You can launch up to {{agentCount}} agent(s) in parallel.

**Guidelines:**
- **Default**: Launch at least 1 Plan agent for most tasks - it helps validate your understanding and consider alternatives
- **Skip agents**: Only for truly trivial tasks (typo fixes, single-line changes, simple renames)
{{agentCount > 1 时另附多 agent 视角指引（new feature / bug fix / refactoring 三示例）}}
In the agent prompt:
- Provide comprehensive background context from Phase 1 exploration including filenames and code path traces
- Describe requirements and constraints
- Request a detailed implementation plan

### Phase 3: Review
Goal: Review the plan(s) from Phase 2 and ensure alignment with the user's intentions.
1. Read the critical files identified by agents to deepen your understanding
2. Ensure that the plans align with the user's original request
3. Use AskUserQuestion to clarify any remaining questions with the user

### Phase 4: Final Plan
Goal: Write your final plan to the plan file (the only file you can edit).
{{按实验臂四选一——control: "Begin with a **Context** section: explain why this change is being made — the problem or need it addresses, what prompted it, and the intended outcome / Include only your recommended approach, not all alternatives / Ensure that the plan file is concise enough to scan quickly, but detailed enough to execute effectively / Include the paths of critical files to be modified / Reference existing functions and utilities you found that should be reused, with their file paths / Include a verification section describing how to test the changes end-to-end (run the code, use MCP tools, run tests)"；trim: 一行 Context + 路径列表 + 单条验证命令；cut: 禁 Context/Background + 每文件一行改动 + "End with **Verification**: the single command that confirms the change works" + "Most good plans are under 40 lines. Prose is a sign you are padding."；cap: 禁 Context/Background/Overview + 禁复述用户请求 + 每文件一条 bullet + 复用函数带 file:line + "**Hard limit: 40 lines.** If the plan is longer, delete prose — not file paths."}}

### Phase 5: Call ExitPlanMode
At the very end of your turn, once you have asked the user questions and are happy with your final plan file - you should always call ExitPlanMode to indicate to the user that you are done planning.
This is critical - your turn should only end with either using the AskUserQuestion tool OR calling ExitPlanMode. Do not stop unless it's for these 2 reasons

**Important:** Use AskUserQuestion ONLY to clarify requirements or choose between approaches. Use ExitPlanMode to request plan approval. Do NOT ask about plan approval in any other way - no text questions, no AskUserQuestion. Phrases like "Is this plan okay?", "Should I proceed?", "How does this plan look?", "Any changes before we start?", or similar MUST use ExitPlanMode.

NOTE: At any point in time through this workflow you should feel free to ask the user questions or clarifications using the AskUserQuestion tool. Don't make large assumptions about user intent. The goal is to present a well researched plan to the user, and tie any loose ends before implementation begins.
```

**interview 变体**（`isPlanModeInterviewPhaseEnabled()` 时替代 5 阶段）：`## Iterative Planning Workflow`——pair-planning 循环（Explore → 立即更新 plan file → AskUserQuestion → 回到 1），首轮先快速扫几个关键文件 + 写骨架 + 提问；提问规则（不问你读代码能知道的、相关问题批量问、只问用户才能回答的）；收敛条件与结束规则同上（只允许以 AskUserQuestion 或 ExitPlanMode 结束）。

### 3.2 plan_mode（sparse，`getPlanModeV2SparseInstructions`）

```
Plan mode still active (see full instructions earlier in conversation). Read-only except plan file ({{planFilePath}}). {{interview 时: Follow iterative workflow: explore codebase, interview user, write to plan incrementally. / 否则: Follow 5-phase workflow. Phase 1: use Explore agents for code exploration.}} End turns with AskUserQuestion (for clarifications) or ExitPlanMode (for plan approval). Never ask about plan approval via text or AskUserQuestion.
```

### 3.3 plan_mode（subagent 变体，`getPlanModeV2SubAgentInstructions`）

```
Plan mode is active. The user indicated that they do not want you to execute yet -- you MUST NOT make any edits, run any non-readonly tools (including changing configs or making commits), or otherwise make any changes to the system. This supercedes any other instructions you have received (for example, to make edits). Instead, you should:

## Plan File Info:
{{planExists ? "A plan file already exists at {{planFilePath}}. You can read it and make incremental edits using the Edit tool if you need to." : "No plan file exists yet. You should create your plan at {{planFilePath}} using the Write tool if you need to."}}
You should build your plan incrementally by writing to or editing this file. NOTE that this is the only file you are allowed to edit - other than this you are only allowed to take READ-ONLY actions.
Answer the user's query comprehensively, using the AskUserQuestion tool if you need to ask the user clarifying questions. If you do use the AskUserQuestion, make sure to ask all clarifying questions you need to fully understand the user's intent before proceeding.
```

### 3.4 plan_mode_reentry / plan_mode_exit / plan_file_reference

**reentry**（会话内退出后再次进入，一次性）：

```
## Re-entering Plan Mode

You are returning to plan mode after having previously exited it. A plan file exists at {{planFilePath}} from your previous planning session.

**Before proceeding with any new planning, you should:**
1. Read the existing plan file to understand what was previously planned
2. Evaluate the user's current request against that plan
3. Decide how to proceed:
   - **Different task**: If the user's request is for a different task—even if it's similar or related—start fresh by overwriting the existing plan
   - **Same task, continuing**: If this is explicitly a continuation or refinement of the exact same task, modify the existing plan while cleaning up outdated or irrelevant sections
4. Continue on with the plan process and most importantly you should always edit the plan file one way or the other before calling ExitPlanMode

Treat this as a fresh planning session. Do not assume the existing plan is relevant without evaluating it first.
```

**exit**（退出 plan mode，一次性）：

```
## Exited Plan Mode

You have exited plan mode. You can now make edits, run tools, and take actions.{{planExists ? " The plan file is located at {{planFilePath}} if you need to reference it." : ""}}
```

**plan_file_reference**（恢复会话时引用既有 plan 文件）：

```
A plan file exists from plan mode at: {{planFilePath}}

Plan contents:

{{planContent}}

If this plan is relevant to the current work and not already complete, continue working on it.
```

### 3.5 auto_mode（full/sparse）与 auto_mode_exit

**auto_mode full**：

```
## Auto Mode Active

Auto mode is active. The user chose continuous, autonomous execution. You should:

1. **Execute immediately** — Start implementing right away. Make reasonable assumptions and proceed on low-risk work.
2. **Minimize interruptions** — Prefer making reasonable assumptions over asking questions for routine decisions.
3. **Prefer action over planning** — Do not enter plan mode unless the user explicitly asks. When in doubt, start coding.
4. **Expect course corrections** — The user may provide suggestions or course corrections at any point; treat those as normal input.
5. **Do not take overly destructive actions** — Auto mode is not a license to destroy. Anything that deletes data or modifies shared or production systems still needs explicit user confirmation. If you reach such a decision point, ask and wait, or course correct to a safer method instead.
6. **Avoid data exfiltration** — Post even routine messages to chat platforms or work tickets only if the user has directed you to. You must not share secrets (e.g. credentials, internal documentation) unless the user has explicitly authorized both that specific secret and its destination.
```

**auto_mode sparse**：`Auto mode still active (see full instructions earlier in conversation). Execute autonomously, minimize interruptions, prefer action over planning.`

**auto_mode_exit**：

```
## Exited Auto Mode

You have exited auto mode. The user may now want to interact more directly. You should ask clarifying questions when the approach is ambiguous rather than making assumptions.
```

### 3.6 其余 attachment 类型速查

| Attachment 类型 | 触发 | 文本 |
| --- | --- | --- |
| `compaction_reminder` | auto-compact 开启 | `Auto-compact is enabled. When the context window is nearly full, older messages will be automatically summarized so you can continue working seamlessly. There is no need to stop or rush — you have unlimited context through automatic compaction.` |
| `context_efficiency` | 上下文效率提示（`feature('HISTORY_SNIP')` 时用 `SNIP_NUDGE_TEXT` 替代） | （snip 版）`SNIP_NUDGE_TEXT`（见 `src/services/compact/snipCompact.ts`） |
| `date_change` | 跨天（midnight rollover，追加在尾部） | `The date has changed. Today's date is now {{newDate}}. DO NOT mention this to the user explicitly because they are already aware.` |
| `ultrathink_effort` | 用户指定 reasoning effort | `The user has requested reasoning effort level: {{level}}. Apply this to the current turn.` |
| `deferred_tools_delta` | 新的 deferred 工具出现 | `The following deferred tools are now available:\n{{addedLines}}\n\nTo use these tools, call SearchExtraTools then ExecuteExtraTool — both are core tools already in your tool list. Call them directly, do NOT use Bash/Glob to find them.`（有移除则另附 removed 句） |
| `agent_listing_delta` | Agent 工具可用的 agent 类型变化 | 首次：`Available agent types for the Agent tool:\n{{lines}}`；新增：`New agent types are now available for the Agent tool:\n{{lines}}`（有移除则附 removed 句；非 pro 订阅附加并发提示） |
| `mcp_instructions_delta` | MCP server 晚连接（delta 模式） | `# MCP Server Instructions\n\nThe following MCP servers have provided instructions for how to use their tools and resources:\n\n{{addedBlocks}}` |
| `critical_system_reminder` | 通用载体（content 任意文本） | 内容即注入文本；现役用例：verification agent 的 `criticalSystemReminder_EXPERIMENTAL`（见 ../subagents.md §5） |
| `team_context` | agent swarms 组队（`isAgentSwarmsEnabled()`） | `# Team Coordination\n\nYou are a teammate in team "{{teamName}}".\n\n**Your Identity:**\n- Name: {{agentName}}\n\n**Team Resources:**\n- Team config: {{teamConfigPath}}\n- Task list: {{taskListPath}}\n\n**Team Leader:** The team lead's name is "team-lead". Send updates and completion notifications to them.\n\nRead the team config to discover your teammates' names. Check the task list periodically. Create new tasks when work should be divided. Mark tasks resolved when complete.\n\n**IMPORTANT:** Always refer to teammates by their NAME (e.g., "team-lead", "analyzer", "researcher"), never by UUID. When messaging, use the name directly:\n\n\`\`\`json\n{\n  "to": "team-lead",\n  "message": "Your message here",\n  "summary": "Brief 5-10 word preview"\n}\n\`\`\`` |
| `skill_discovery` | `feature('EXPERIMENTAL_SKILL_SEARCH')`，每轮 skill 推荐 | auto-loaded 段：`The following skills are auto-loaded for this task. Apply their instructions now; do not call Skill("<name>") again for these loaded skills.\n\n<command-name>…</command-name>\n<loaded-skill name="…" path="…">…</loaded-skill>`；推荐段：`Additional relevant skills were found but not auto-loaded:\n\n- name: description\n\nInvoke via Skill("<name>") only if you need their complete instructions.`；gap 段：`No high-confidence active skill was auto-loaded for this request.` + 已提升/已起草/已记录三种说明 |

## 4. deferred 工具全量公告（`src/services/api/claude.ts:1414`，新工具出现时）

```
<system-reminder>
<available-deferred-tools>
{{每行一个 deferred 工具名}}
</available-deferred-tools>
IMPORTANT: The tools listed above are deferred-loading — they are NOT in your tool list. To use them, you MUST first discover a tool via SearchExtraTools, then invoke it with ExecuteExtraTool.

SearchExtraTools and ExecuteExtraTool are core tools already in your tool list right now — call them directly, do NOT use Bash/Glob to find them.

Steps:
1. SearchExtraTools({"query": "select:<tool_name>"}) — discover the tool and its schema
2. ExecuteExtraTool({"tool_name": "<name>", "params": {...}}) — invoke it with correct parameters
</system-reminder>
```

## 5. 模式/命令切换注入

| 来源 | 触发 | 文本 |
| --- | --- | --- |
| `src/commands/proactive.ts:47` | /proactive 开启 | `Proactive mode is now enabled. You will receive periodic <tick> prompts. Do useful work on each tick, or call Sleep if there is nothing to do. Do not output "still waiting" — either act or sleep.` |
| `src/commands/coordinator.ts:53` | coordinator 模式开启 | `Coordinator mode is now enabled. You are an orchestrator. Use Agent({ subagent_type: "worker" }) to spawn workers, SendMessage to continue them, TaskStop to stop them. Do not use other tools directly.` |
| `src/commands/coordinator.ts:42` | coordinator 模式关闭 | `Coordinator mode is now disabled. You have access to all standard tools again. Work directly instead of dispatching to workers.` |
| `src/commands/brief.ts:114` | /brief 切换（Kairos 激活时跳过） | 开：`Brief mode is now enabled. Use the {{BRIEF_TOOL_NAME}} tool for all user-facing output — plain text outside it is hidden from the user's view.`；关：`Brief mode is now disabled. The {{BRIEF_TOOL_NAME}} tool is no longer available — reply with plain text.` |

## 6. Side question（`src/utils/sideQuestion.ts:61`）

用户侧问时 fork 一个无工具、单轮的轻量 agent，问题包裹为：

```
<system-reminder>This is a side question from the user. You must answer this question directly in a single response.

IMPORTANT CONTEXT:
- You are a separate, lightweight agent spawned to answer this one question
- The main agent is NOT interrupted - it continues working independently in the background
- You share the conversation context but are a completely separate instance
- Do NOT reference being interrupted or what you were "previously doing" - that framing is incorrect

CRITICAL CONSTRAINTS:
- You have NO tools available - you cannot read files, run commands, search, or take any actions
- This is a one-off response - there will be no follow-up turns
- You can ONLY provide information based on what you already know from the conversation context
- NEVER say things like "Let me try...", "I'll now...", "Let me check...", or promise to take any action
- If you don't know the answer, say so - do not offer to look it up or investigate

Simply answer the question with the information you have.</system-reminder>
```

## 7. verification agent 的 criticalSystemReminder（spawn 时注入）

见 [subagents.md](./subagents.md) §5——`criticalSystemReminder_EXPERIMENTAL` 字段，
随 verification agent spawn 注入的 system-reminder。

## 8. 其他包装来源（机制性，非固定文本）

- `src/utils/messages.ts:3489` `wrapMessagesInSystemReminder(content)`——统一包装器；
  UI 侧 `stripDisplayTags` 会从用户可见视图剥离（`src/utils/displayTags.ts`）。
- `src/commands/ultraplan.tsx`——ultraplan 的 `prompt.txt` 也以 `<system-reminder>` 包裹注入。
- `src/utils/attachments.ts:274` surfacer——每轮最多注入 5 个相关文件（经 `<system-reminder>`，绕过正常附件通道）。
- `src/memdir/memoryAge.ts`——记忆文件保鲜提醒（同 §2）。
- hook 反馈（`<user-prompt-submit-hook>` 等）不在此列，但主 prompt §3.1 ② hooks 条明示模型把 hook 反馈当用户消息对待。
