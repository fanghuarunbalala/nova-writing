# Claude Code Team Mode（Agent Teams）机制整理

> 参照物：`D:\workplace\NovelAI-Compose\vendor\claude-code`（**claude-code-best 2.8.4**，
> 基于官方 Claude Code 2.x 的逆向工程/扩展版，bin 名 `ccb`，下称 CCB）。
> 官方 `anthropics/claude-code` 仓库只有 CLI 壳 + changelog，无源码；"原始代码"以本 vendor 为准。
> 本目录 `tools/` 的 62 份工具文档（提取于 2026-08-16）已逐字核对，与 2.8.4 同源一致。
> 整理时间：2026-08-20。所有引文均为原文照录，每节注明源码位置。

**一句话结论**：CC 的团队模式核心不是复杂 IPC，而是**三份磁盘文件 + 一个双路径 Agent 工具**——
`team file`（团队清单）、`mailbox`（每人一个 JSON 收件箱）、`task list`（任务板，Team 与 TaskList 1:1）。
teammate 是"可寻址、常驻、多轮"的 agent；subagent 是"一次性、同进程、单轮回报"的 agent；
二者是同一个 `Agent` 工具的两条路径（带 `name` + `team_name` 参数 → teammate，否则 → subagent）。

---

## 1. Team Mode 整体机制

### 1.1 三份文件协议（无 IPC）

| 状态载体 | 路径 | 作用 |
| --- | --- | --- |
| team file | `~/.claude/teams/<team>/team.json` | 成员清单（agentId/name/model/cwd/backendType）、leadSessionId、teamAllowedPaths |
| mailbox | `~/.claude/teams/<team>/inboxes/<agent>.json` | 每人一个收件箱，消息 JSON append，文件锁 + 原子写 |
| task list | `~/.claude/tasks/<taskListId>/*.json` | 每任务一个文件，锁 + 高水位线分配 ID；taskListId 取团队名 → 全员共享同一任务板 |

`TeamCreate` **不 spawn 任何进程**，只做初始化（`packages/builtin-tools/src/tools/TeamCreateTool/TeamCreateTool.ts:129-199`）：

```ts
const finalTeamName = generateUniqueTeamName(team_name)
const leadAgentId = formatAgentId(TEAM_LEAD_NAME, finalTeamName)
const teamFile: TeamFile = {
  name: finalTeamName, description: _description, createdAt: Date.now(),
  leadAgentId, leadSessionId: getSessionId(),
  members: [{ agentId: leadAgentId, name: TEAM_LEAD_NAME, agentType: leadAgentType,
    model: leadModel, joinedAt: Date.now(), tmuxPaneId: '', cwd: getCwd(), subscriptions: [] }],
}
await writeTeamFileAsync(finalTeamName, teamFile)
registerTeamForSessionCleanup(finalTeamName)   // session 结束自动清理
const taskListId = sanitizeName(finalTeamName)
await resetTaskList(taskListId)                // Team = Project = TaskList，任务编号从 1 重来
setLeaderTeamName(sanitizeName(finalTeamName)) // getTaskListId() 对 leader 返回团队名
setAppState(prev => ({ ...prev, teamContext: { teamName: finalTeamName, ... } }))
```

### 1.2 进程模型：三种 backend 可插拔，一套文件协议

teammate 有两种运行方式（`src/utils/swarm/backends/` 下有 `TmuxBackend.ts`、`ITermBackend.ts`、
`WindowsTerminalBackend.ts`、`InProcessBackend.ts`，由 `registry.ts` 注册、`teammateModeSnapshot.ts`
按 env 快照决定当前模式）。

**（a）tmux/终端 = 独立 Claude Code 进程**。核心 spawn 逻辑
（`src/utils/swarm/backends/PaneBackendExecutor.ts:158-203`）——初始 prompt **不走命令行参数，
先写进 teammate 的 mailbox**，进程启动后由收件箱轮询读到再提交为用户消息：

```ts
// Build the command to spawn Claude Code with teammate identity
const binaryPath = getTeammateCommand()
const teammateArgs = [
  '--agent-id', agentId,
  '--agent-name', config.name,
  '--team-name', config.teamName,
  '--agent-color', teammateColor,
  '--parent-session-id', config.parentSessionId || getSessionId(),
  ...(config.planModeRequired ? ['--plan-mode-required'] : []),
  ...(config.agentType ? ['--agent-type', config.agentType] : []),
]
const allArgs = [...teammateArgs, ...inheritedArgParts]
const spawnCommand =
  this.type === 'windows-terminal'
    ? buildPowerShellSpawnCommand(binaryPath, allArgs, workingDir)
    : `cd ${quote([workingDir])} && env ${envStr} ${quote([binaryPath])} ${quote(allArgs)}`
// Send the command to the new pane
await this.backend.sendCommandToPane(paneId, spawnCommand, !insideTmux)
// Send initial instructions to teammate via mailbox
await writeToMailbox(config.name, { from: 'team-lead', text: config.prompt, timestamp: ... }, config.teamName)
```

子进程继承 `--model`/`--settings`/`--plugin-dir`/cwd，强制注入 `CLAUDECODE=1` +
`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`（`src/utils/swarm/spawnUtils.ts:106-165`）。
`getTeammateCommand()`（`src/utils/swarm/spawnUtils.ts:23-28`）：`CLAUDE_CODE_TEAMMATE_COMMAND` env
覆盖，否则 `process.execPath`（bundle 模式）或 `process.argv[1]`。

**（b）in-process = 同进程 AsyncLocalStorage 隔离任务**
（`src/utils/swarm/spawnInProcess.ts:105-217`）：确定性 `agentId = formatAgentId(name, teamName)`、
独立 AbortController（注释："Teammates should not be aborted when the leader's query is interrupted"）、
常驻循环 `waitForNextPromptOrShutdown`（500ms 轮询，`src/utils/swarm/inProcessRunner.ts:700-879`）。
注释原话（inProcessRunner.ts:896-901）：*"Unlike background tasks, teammates stay alive and can receive
multiple prompts"*——teammate 与一次性 subagent 的本质区别。它还会 `tryClaimNextTask(taskListId, agentName)`
**自动认领任务板上未认领的任务**。

### 1.3 mailbox 通信协议

`src/utils/teammateMailbox.ts` — 每个 teammate 一个 JSON 文件收件箱（:278-291）：

```ts
export function getInboxPath(agentName: string, teamName?: string): string {
  const team = teamName || getTeamName() || 'default'
  const safeTeam = sanitizePathComponent(team)
  const safeAgentName = sanitizePathComponent(agentName)
  const inboxDir = join(getTeamsDir(), safeTeam, 'inboxes')
  return join(inboxDir, `${safeAgentName}.json`)
}
```

`writeToMailbox`（:358-397）：`proper-lockfile`（`${inboxPath}.lock`）加锁 → 重读 → append →
临时文件 + rename 原子写（:153-165）。上限常量（:44-49）：MAX_MAILBOX_MESSAGES=1000、
MAX_UNREAD_PROTOCOL=2000、单条 64KB、文件 4MB，超限由 `compactMailboxMessages` 压缩。

轮询：UI 侧 1s（`src/hooks/useInboxPoller.ts`，`INBOX_POLL_INTERVAL_MS = 1000`）；in-process teammate
不走它（注释："they have their own... would cause message routing issues"），改用 inProcessRunner 内
500ms 轮询。消息支持**结构化类型**（`SendMessageTool.ts` inputSchema）：`shutdown_request` /
`shutdown_response`（approve+reason）/ `plan_approval_response`（approve+feedback）——普通文本与
协议消息同通道，靠 JSON 区分并做优先级排序（shutdown 优先于普通消息，team-lead 消息优先于 peer 消息）。
idle 通知（`createIdleNotification`）也走 mailbox——teammate 的 Stop hook 发 idle 通知给 leader
（`src/utils/swarm/teammateInit.ts:98-128`）。

### 1.4 协作循环（模型侧一手文案，`TeamCreateTool/prompt.ts:37-45`）

```
## Team Workflow
1. **Create a team** with TeamCreate - this creates both the team and its task list
2. **Create tasks** using the Task tools (TaskCreate, TaskList, etc.) - they automatically use the team's task list
3. **Spawn teammates** using the Agent tool with `team_name` and `name` parameters to create teammates that join the team
4. **Assign tasks** using TaskUpdate with `owner` to give tasks to idle teammates
5. **Teammates work on assigned tasks** and mark them completed via TaskUpdate
6. **Teammates go idle between turns** - after each turn, teammates automatically go idle and send a notification.
   IMPORTANT: Be patient with idle teammates! Don't comment on their idleness until it actually impacts your work.
7. **Shutdown your team** - when the task is completed, gracefully shut down your teammates via SendMessage
   with `message: {type: "shutdown_request"}`.
```

### 1.5 审批流

- `TeamCreate` **不需要用户确认**（TeamCreateTool 无 checkPermissions，默认 allow）。
- teammate 的 **plan 审批**：Agent 工具 `mode:'plan'` → teammate 以 `--plan-mode-required` 启动 →
  teammate 提交 plan 后，lead 用 SendMessage 回 `plan_approval_response`；teammate 侧
  `useInboxPoller.ts:156-195` 校验**消息必须来自 team-lead**（防伪造）才切换 permission mode；
  只有 `isTeamLead()` 能批准/拒绝（`SendMessageTool.ts:467-509`）。
- **shutdown 审批**：teammate 模型自行决定 approve/reject（inProcessRunner.ts:698 注释：
  "Does NOT auto-approve shutdown - the model should make that decision"）；approve 后 in-process
  走 `abortController.abort()`（SendMessageTool.ts:381-399），tmux 走 `gracefulShutdown(0,'other')`。
- in-process teammate 的权限弹窗经 `src/utils/swarm/leaderPermissionBridge.ts`
  （`registerLeaderToolUseConfirmQueue`）桥接到 leader 的确认队列。
- 团队级 allowedPaths：`teammateInit.ts:45-79` 把 team file 里的 `teamAllowedPaths` 注入 teammate 的
  toolPermissionContext。

### 1.6 teammate 的 system prompt 构造

独立进程版本（`src/utils/swarm/teammatePromptAddendum.ts:8-18`，全文）：

```
# Agent Teammate Communication

IMPORTANT: You are running as an agent in a team. To communicate with anyone on your team:
- Use the SendMessage tool with `to: "<name>"` to send messages to specific teammates
- Use the SendMessage tool with `to: "*"` sparingly for team-wide broadcasts

Just writing a response in text is not visible to others on your team - you MUST use the SendMessage tool.

The user interacts primarily with the team lead. Your work is coordinated through the task system and teammate messaging.
```

in-process 版本额外**强制注入团队工具**并给全权限（`src/utils/swarm/inProcessRunner.ts:999-1015`）：

```ts
tools: agentDefinition?.tools
  ? [...new Set([...agentDefinition.tools, SEND_MESSAGE_TOOL_NAME, TEAM_CREATE_TOOL_NAME,
      TEAM_DELETE_TOOL_NAME, TASK_CREATE_TOOL_NAME, TASK_GET_TOOL_NAME,
      TASK_LIST_TOOL_NAME, TASK_UPDATE_TOOL_NAME])]
  : ['*'],
permissionMode: 'default',   // teammates always get full tool access regardless of leader's mode
```

每条消息注入时还有 `<system-reminder>`（`src/utils/messages.ts:3861-3886`）：
*"You are a teammate in team ..."*、*"**Team Leader:** The team lead's name is \"team-lead\".
Send updates and completion notifications to them."*、*"Check the task list periodically.
Create new tasks when work should be divided. Mark tasks resolved when complete."*

### 1.7 功能开关与身份入口

- feature 门控：`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`（禁用为 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS_DISABLED`）。
- teammate 进程身份：`src/main.tsx:1612-1648` 解析 `--agent-id / --agent-name / --team-name / --agent-color /
  --parent-session-id` CLI 参数（三者必须同时提供，否则报错退出）。
- **该版本没有 `/teammate` slash 命令**（`src/commands/` 全量核对无命中）。teammate 入口只有两个：
  Agent 工具的 `name`+`team_name` 参数、以及 KAIROS/assistant 预置团队（`src/main.tsx:1507-1511`，
  "Pre-seed an in-process team so Agent(name: \"foo\") spawns teammates without TeamCreate"）。

---

## 2. 提供的 Tools 及作用

全部在 `packages/builtin-tools/src/tools/<ToolName>/`（`prompt.ts` = 模型侧描述，`<ToolName>.ts(x)`
= zod schema + call）。下表"作用"均为 prompt.ts 一手文案；完整 desc + schema 见本目录 `tools/*.md`
（62 份，已验证与 2.8.4 同源）。

| 工具 | 模型侧描述（原文摘录） | 关键参数/机制 |
| --- | --- | --- |
| **TeamCreate** | 见 1.4 Team Workflow；"Teams have a 1:1 correspondence with task lists (Team = TaskList)"（prompt.ts:24） | `team_name` / `description` / `agent_type`；无条件门槛，无需确认 |
| **TeamDelete** | "Remove team and task directories when the swarm work is complete... **IMPORTANT**: TeamDelete will fail if the team still has active members"（prompt.ts:3-14） | `wait_ms`（0-30000）；按 backendType 分派 terminate（in-process → `executor.terminate`，pane → `gracefulShutdown`，TeamDeleteTool.ts:115-143）；清 team 目录 + 任务目录 + AppState.teamContext + inbox |
| **SendMessage** | "Send a message to another agent... Your plain text output is NOT visible to other agents — to communicate, you MUST call this tool"（prompt.ts:3,23-36） | `to`：名字 / `"*"` 广播（"expensive (linear in team size), use only when everyone genuinely needs it"）/ `uds:`/`bridge:`/`tcp:` 地址；`summary` + `message`（字符串或 shutdown/plan 结构化消息）；对已停止的 subagent 自动 resume（call() 911-987）；跨进程目标 `behavior:'ask'` 要用户确认（623-648），**同团队内直接 allow** |
| **ListPeers** | "Discover other Claude Code sessions for cross-session messaging"（ListPeersTool.ts:40-49） | 扫描 UDS socket（`udsClient.listPeers`）+ bridge peers（`bridgePeers.listBridgePeers`），返回地址供 SendMessage 用；`feature('UDS_INBOX')` 门控（src/tools.ts） |
| **TaskCreate** | "Create a new task in the task list... It also helps the user understand the progress of the task"（prompt.ts:3,16-17） | `subject/description/activeForm/metadata`；`isTodoV2Enabled()` 门控（src/tools.ts）；落盘 `~/.claude/tasks/<taskListId>/<id>.json`，`lockfile.lock` + 高水位线（`findHighestTaskId`）并发 ID 唯一（src/utils/tasks.ts:221-308）；`getTaskListId()` 优先级：`CLAUDE_CODE_TASK_LIST_ID` → in-process 团队名 → `CLAUDE_CODE_TEAM_NAME` → leaderTeamName → sessionId（tasks.ts:199-210） |
| **TaskGet** | "Get a task by ID from the task list"（prompt.ts:1-3） | 含 `blocks`/`blockedBy` 依赖 |
| **TaskUpdate** | "Update a task in the task list... **owner**: Change the task owner (agent name)；**addBlocks**...（prompt.ts:30-39） | status 含 `'deleted'` 特殊值；teammate 标 in_progress 时**自动把 owner 填为 `getAgentName()`**（:188-199）；owner 变更时自动给新 owner 写 `task_assignment` mailbox 消息（:277-298）；完成任务时 tool_result 附 "Task completed. Call TaskList now to find your next available task or see if your work unblocked others."（:387-394） |
| **TaskList** | 含 Teammate Workflow（prompt.ts:17-25）：完成后查任务板 → 找 pending/无 owner/无 blockedBy → **优先 ID 最小** → TaskUpdate 认领或等 leader 派发 | |
| **TaskStop** | "Stops a running background task by its ID"（prompt.ts:1-8） | `task_id` |
| **Agent** | "Launch a new agent to handle complex, multi-step tasks autonomously... specify a subagent_type parameter... If omitted, the general-purpose agent is used"（prompt.ts:120-126） | `description/prompt/subagent_type/model/run_in_background` + 团队扩展 `name`（"Makes it addressable via SendMessage({to: name}) while running"，AgentTool.tsx:159-162）、`team_name`（"Team name for spawning. Uses current team context if omitted."，:163）、`mode`（permissionMode，如 `'plan'`）、`isolation`（worktree/remote）、`cwd`。带 name+team → `spawnTeammate`（call() 375-408）；不带 → 同进程 `runAgent()`（runAgent.ts:776-785，复用 query 循环 + `createSubagentContext` 隔离 agentId/abortController） |
| **TodoWrite** | V1 待办，`todos` 整体替换 | 按 `context.agentId ?? getSessionId()` 分 key（TodoWriteTool.ts:65-103）；`isEnabled = !isTodoV2Enabled()` |
| **AskUserQuestion** | 主线程弹窗打断 | `questions` 1-4 问（AskUserQuestionTool.tsx:119-125） |

装配细节（src/tools.ts:69-79,153-155,220-258）：TeamCreate/TeamDelete/SendMessage 用 lazy require
打破循环依赖；SendMessage 在 swarms 开启时 `alwaysLoad`，否则走 **deferred 工具机制**——需
`SearchExtraTools` 发现 + `ExecuteExtraTool` 调用。主 system prompt 专段
（src/constants/prompts.ts:191）：

```
IMPORTANT — tool priority: When a task can be done by a core tool, use that core tool directly —
never wrap it through ExecuteExtraTool. However, when <available-deferred-tools> or <system-reminder>
lists a deferred tool that is relevant to the task (e.g., TeamCreate, CronCreate, SendMessage), you MUST
use ExecuteExtraTool to invoke it — that is the ONLY way to call deferred tools. ... but use
ExecuteExtraTool({"tool_name": "TeamCreate", "params": {...}}) when the user asks to create a team.
```

限制（AgentTool/prompt.ts:190-196）：

```
- The run_in_background, name, team_name, and mode parameters are not available in this context.
  Only synchronous subagents are supported.        // in-process teammate 内
- The name, team_name, and mode parameters are not available in this context — teammates cannot
  spawn other teammates. Omit them to spawn a subagent.   // tmux teammate 内
```

### 2.1 Subagent（同 Agent 工具的对照面）

built-in agents 在 `packages/builtin-tools/src/tools/AgentTool/built-in/`：
`generalPurposeAgent.ts`、`exploreAgent.ts`、`planAgent.ts`、`claudeCodeGuideAgent.ts`、
`statuslineSetup.ts`、`verificationAgent.ts`；装配在 `builtInAgents.ts`
（默认 GENERAL_PURPOSE + STATUSLINE_SETUP，Explore/Plan 由 `BUILTIN_EXPLORE_PLAN_AGENTS` 门控）。
Explore 定义示例（exploreAgent.ts:59-83）：

```ts
export const EXPLORE_AGENT: BuiltInAgentDefinition = {
  agentType: 'Explore',
  whenToUse: 'Fast agent specialized for exploring codebases. ... specify the desired thoroughness level: "quick" ... "very thorough" ...',
  disallowedTools: [
    AGENT_TOOL_NAME, EXIT_PLAN_MODE_TOOL_NAME,
    FILE_EDIT_TOOL_NAME, FILE_WRITE_TOOL_NAME, NOTEBOOK_EDIT_TOOL_NAME,
  ],
  source: 'built-in',
  baseDir: 'built-in',
  model: process.env.USER_TYPE === 'ant' ? 'inherit' : 'haiku',
  omitClaudeMd: true,
  getSystemPrompt: () => getExploreSystemPrompt(),
}
```

general-purpose（generalPurposeAgent.ts:48-70）：`tools: ['*']`、`model` 省略（用
`getDefaultSubagentModel()`）、system prompt 强调 "NEVER create files... NEVER proactively create
documentation files"。subagent 不 spawn 进程——`runAgent()` 在父进程内直接调 `query()`，
支持 `run_in_background`（async 输出 `{status:'async_launched', agentId, outputFile}`）与
`isolation:'worktree'`（临时 git worktree）。

---

## 3. Nudge：机制与改进

全库 grep -rin "nudge" 共 78 处。**没有用户按键触发的 nudge**（keybindings 14 个文件核对：
Ctrl+C=`app:interrupt`、Esc=`chat:cancel`，无 N 键绑定）。全部是 agent 内部自动注入，共 6 类。

### ① token budget 续跑 nudge（核心）

决策（src/query/tokenBudget.ts:22-29,45-93）：

```ts
const COMPLETION_THRESHOLD = 0.9
const DIMINISHING_THRESHOLD = 500
...
  const turnTokens = globalTurnTokens
  const pct = Math.round((turnTokens / budget) * 100)
  const deltaSinceLastCheck = globalTurnTokens - tracker.lastGlobalTurnTokens

  const isDiminishing =
    tracker.continuationCount >= 3 &&
    deltaSinceLastCheck < DIMINISHING_THRESHOLD &&
    tracker.lastDeltaTokens < DIMINISHING_THRESHOLD

  if (!isDiminishing && turnTokens < budget * COMPLETION_THRESHOLD) {
    tracker.continuationCount++
    tracker.lastDeltaTokens = deltaSinceLastCheck
    tracker.lastGlobalTurnTokens = globalTurnTokens
    return { action: 'continue', nudgeMessage: getBudgetContinuationMessage(pct, turnTokens, budget), ... }
  }
  if (isDiminishing || tracker.continuationCount > 0) {
    return { action: 'stop', completionEvent: { ..., diminishingReturns: isDiminishing, ... } }
  }
  return { action: 'stop', completionEvent: null }
```

nudge 文案（src/utils/tokenBudget.ts:66-73）：

```ts
export function getBudgetContinuationMessage(pct, turnTokens, budget): string {
  const fmt = (n: number): string => new Intl.NumberFormat('en-US').format(n)
  return `Stopped at ${pct}% of token target (${fmt(turnTokens)} / ${fmt(budget)}). Keep working — do not summarize.`
}
```

注入方式（src/query.ts:1598-1631，`feature('TOKEN_BUDGET')` 门控；前置条件 tokenBudget.ts:51：
仅主线程且配置了预算）：

```ts
state = {
  messages: [ ...messagesForQuery, ...assistantMessages,
    createUserMessage({ content: decision.nudgeMessage, isMeta: true }) ],
  ...
  transition: { reason: 'token_budget_continuation' },
}
continue
```

UI 侧计数：REPL 显示 `getBudgetContinuationCount()`（src/screens/REPL.tsx:3757-3767）；
SystemTextMessage 显示 "· n nudges"（src/components/messages/SystemTextMessage.tsx:316-320）。

**改进点**：
- **diminishing returns 判定**：连续 ≥3 次 nudge 且最近两次增量都 <500 tokens → 判定空转，
  强制 stop（`completionEvent.diminishingReturns`），防无限续跑死循环；
- **meta 用户消息注入**：不污染真实对话历史，UI 可单独标记/计数；
- **pacing**：SNIP nudge 每 10k token 增长且未 snip 才注入一次，命中后重置节奏（见 ②）。

### ② SNIP 压缩 nudge（context-efficiency）

文案（src/services/compact/snipCompact.ts:17-18）：

```ts
export const SNIP_NUDGE_TEXT: string =
  'The conversation history is getting long. Consider using the /force-snip command or the snip tool to compress older messages, freeing context window space for continued work.'
```

触发（snipCompact.ts:163-165 + :11）：`shouldNudgeForSnips = messages.length >= SNIP_NUDGE_THRESHOLD`（阈值 30 条）。
注入链（src/utils/attachments.ts:4039-4065 + src/utils/messages.ts:4590-4595）：`feature('HISTORY_SNIP')` 门控，
作为 `type: 'context_efficiency'` attachment / 用户消息注入。pacing 注释原话（attachments.ts）：

```
Injected after every N tokens of growth without a snip. Pacing is handled entirely by
shouldNudgeForSnips — the 10k interval resets on prior nudges, snip markers, snip boundaries,
and compact boundaries.
```

### ③ Verification nudge（多代理相关）

主线程 agent 一次关闭 ≥3 个任务且都没有 verification 步骤时，TodoWrite/TaskUpdate 的 tool_result
追加（TodoWriteTool.ts:106-112；TaskUpdateTool.ts:333-349,396-398，`VERIFICATION_AGENT` feature +
`tengu_hive_evidence` GrowthBook 门控）：

```
NOTE: You just closed out 3+ tasks and none of them was a verification step. Before writing your
final summary, spawn the verification agent (subagent_type="Verification"). You cannot self-assign
PARTIAL by listing caveats in your summary — only the verifier issues a verdict.
```

TodoWrite 侧同款（TodoWriteTool.ts:106-112）：

```
Do not write a completion message yet — take one more pass: verify the work you did actually
compiles/runs and achieves the user's goal before declaring the task done. This step is optional
only if it is genuinely not applicable.
```

### ④ upgrade nudge

claude.ai 客户端升级提醒（仅 REPL v2 bridge 路径，src/bridge/envLessBridgeConfig.ts:156、
src/hooks/useReplBridge.tsx:657-665、SystemTextMessage.tsx:413-422）。

### ⑤ tips 注册表 3 条

src/services/tips/tipRegistry.ts:514-583：`effort-high-nudge`（建议 /effort high）、
`subagent-fanout-nudge`（"Say \"fan out subagents\" and Claude sends a team. Each one digs deep so
nothing gets missed."）、`loop-command-nudge`（建议 /loop），各带 GrowthBook A/B 变体
（copy_a/copy_b）与 cooldownSessions 冷却。

### ⑥ 散点 prompt 文案

- cron 调度建议：`ScheduleCronTool/prompt.ts:103`（"...When in doubt, nudge a few minutes early or late — the user will not notice, and the fleet will."）
- yolo 分类器后缀：`src/utils/permissions/yoloClassifier.ts:551,775`（"Stage 1: fast (suffix nudges immediate <block> decision)"）
- FileRead 定向范围提示：`FileReadTool/FileReadTool.ts:352`、`limits.ts:39,81-90`（`targetedRangeNudge` 配置开关）
- computer-use 切屏提示：`@ant/computer-use-mcp/src/toolCalls.ts:2876`（"Nudge the model toward switch_display BEFORE it wastes steps"）
- sparsePaths 引导：`src/screens/REPL.tsx:1990`

### 小结

CC 的 nudge 是**进程内自动注入**机制（无用户按键），改进集中在三点：
① diminishing-returns 判定防死循环；② pacing（10k token 间隔 + 命中重置）防打扰；
③ meta 消息注入不污染对话。注入载体是 `<system-reminder>` / meta 用户消息 / tool_result 追加三类。

---

## 4. Nova 落点对照

1. **teammate vs subagent 的二分**：本项目进程内 SubagentRuntime 已对应 CC 的 `runAgent` 路径；
   CC 的 `name`+`team_name` → `spawnTeammate` 即规划中 "teammate = 新 conversation 进程"
   （`core/src/conversation/contract/types/message.ts`、`core/src/init/ConversationInit.ts` 的 parentId、
   `core/src/manager/contract/server.ts` 的 `spawnConversation` 通道均已预留）。
2. **通信方案**：CC 的 mailbox 文件协议（锁 + 原子写 + 轮询 + 结构化消息优先级）比 IPC 简单可靠，
   且天然支持跨进程；本项目已有 `sendMessageTo` 调度（manager contract），可对比取舍。
3. **任务板是协作锚点**：`TaskUpdate` 自动填 owner + `task_assignment` mailbox 通知 +
   `TaskList` 认领流程（优先最小 ID）是"团队不自说自话"的关键；本项目目前无共享任务板
   （TodoWrite 是会话内全量替换，V2 任务板未实现）。
4. **审批桥**：teammate 的 plan/shutdown 审批走结构化 SendMessage 且校验 sender 身份；
   本项目 WaitRequestQueue 按 parentId 冒泡（teammate → parent、root → ui）方向一致。
5. **nudge 可借鉴**：本项目 ContextNudgePolicy（todo_idle / project_stage / compose_mode）走
   `<system-reminder>` 注入，与 CC ②③ 类同构；CC 的 diminishing-returns 停止判定与 pacing 重置
   节奏可直接移植到 todo_idle / compose_mode 的稳态提醒上。
