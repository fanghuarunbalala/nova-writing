# Claude Code 工具参考（desc + schema）

每个工具一份文档：模型侧描述（`prompt.ts` 的 `getDescription()`/`PROMPT`，逐字引用）+
zod `inputSchema`（字段、类型、必填性、`.describe()` 原文）。源码在
`vendor/claude-code/packages/builtin-tools/src/tools/<ToolName>/`。

**注册表**：`vendor/claude-code/src/tools.ts` `getAllBaseTools()`。工具分两类——
**core**（直接可调）与 **deferred**（需先 `SearchExtraTools` 发现、再 `ExecuteExtraTool` 调用），
这条二分规则本身写死在主 system prompt（见 ../system-prompt.md §3.1 ②）。

## 工具总表

| 工具 | 文档 | 注册门槛（getAllBaseTools） |
| --- | --- | --- |
| Agent | [AgentTool.md](./AgentTool.md) | 无条件（core） |
| Artifact | [ArtifactTool.md](./ArtifactTool.md) | 无条件（core） |
| AskUserQuestion | [AskUserQuestionTool.md](./AskUserQuestionTool.md) | 无条件（core） |
| Bash | [BashTool.md](./BashTool.md) | 无条件（core） |
| Brief | [BriefTool.md](./BriefTool.md) | 无条件（core） |
| Config | [ConfigTool.md](./ConfigTool.md) | `USER_TYPE === 'ant'` |
| CtxInspect | [CtxInspectTool.md](./CtxInspectTool.md) | `feature('CONTEXT_COLLAPSE')` |
| DiscoverSkills | [DiscoverSkillsTool.md](./DiscoverSkillsTool.md) | `feature('EXPERIMENTAL_SKILL_SEARCH')` |
| EnterPlanMode | [EnterPlanModeTool.md](./EnterPlanModeTool.md) | 无条件（core） |
| EnterWorktree | [EnterWorktreeTool.md](./EnterWorktreeTool.md) | `isWorktreeModeEnabled()` |
| Execute (ExecuteExtraTool) | [ExecuteTool.md](./ExecuteTool.md) | 无条件（core，tool search 的调用端） |
| ExitPlanMode | [ExitPlanModeTool.md](./ExitPlanModeTool.md) | 无条件（core，V2 版） |
| ExitWorktree | [ExitWorktreeTool.md](./ExitWorktreeTool.md) | `isWorktreeModeEnabled()` |
| Edit | [FileEditTool.md](./FileEditTool.md) | 无条件（core） |
| Read | [FileReadTool.md](./FileReadTool.md) | 无条件（core） |
| Write | [FileWriteTool.md](./FileWriteTool.md) | 无条件（core） |
| Glob | [GlobTool.md](./GlobTool.md) | 无条件（core；embedded 构建移除） |
| Goal | [GoalTool.md](./GoalTool.md) | `feature('GOAL')` |
| Grep | [GrepTool.md](./GrepTool.md) | 无条件（core；embedded 构建移除） |
| ListMcpResources | [ListMcpResourcesTool.md](./ListMcpResourcesTool.md) | 无条件（core） |
| ListPeers | [ListPeersTool.md](./ListPeersTool.md) | `feature('UDS_INBOX')` |
| LocalMemoryRecall | [LocalMemoryRecallTool.md](./LocalMemoryRecallTool.md) | 无条件（core） |
| LSP | [LSPTool.md](./LSPTool.md) | `env ENABLE_LSP_TOOL` |
| McpAuth | [McpAuthTool.md](./McpAuthTool.md) | 未注册在 getAllBaseTools |
| MCPTool | [MCPTool.md](./MCPTool.md) | 未注册在 getAllBaseTools（MCP 直连辅助） |
| Monitor | [MonitorTool.md](./MonitorTool.md) | `feature('MONITOR_TOOL')` |
| NotebookEdit | [NotebookEditTool.md](./NotebookEditTool.md) | 无条件（core） |
| OverflowTest | [OverflowTestTool.md](./OverflowTestTool.md) | `feature('OVERFLOW_TEST_TOOL')` |
| PowerShell | [PowerShellTool.md](./PowerShellTool.md) | `isPowerShellToolEnabled()` |
| PushNotification | [PushNotificationTool.md](./PushNotificationTool.md) | `feature('KAIROS' \| 'KAIROS_PUSH_NOTIFICATION')` |
| ReadMcpResource | [ReadMcpResourceTool.md](./ReadMcpResourceTool.md) | 无条件（core） |
| RemoteTrigger | [RemoteTriggerTool.md](./RemoteTriggerTool.md) | `feature('AGENT_TRIGGERS_REMOTE')` |
| REPL | [REPLTool.md](./REPLTool.md) | `USER_TYPE === 'ant'` 且 REPL 模式 |
| ReviewArtifact | [ReviewArtifactTool.md](./ReviewArtifactTool.md) | `feature('REVIEW_ARTIFACT')` |
| CronCreate | [CronCreateTool.md](./CronCreateTool.md) | 无条件（core，ScheduleCronTool 目录） |
| CronDelete | [CronDeleteTool.md](./CronDeleteTool.md) | 无条件（core，ScheduleCronTool 目录） |
| CronList | [CronListTool.md](./CronListTool.md) | 无条件（core，ScheduleCronTool 目录） |
| SearchExtraTools | [SearchExtraToolsTool.md](./SearchExtraToolsTool.md) | `isSearchExtraToolsEnabledOptimistic()`（core，tool search 发现端） |
| SendMessage | [SendMessageTool.md](./SendMessageTool.md) | 无条件（core） |
| SendUserFile | [SendUserFileTool.md](./SendUserFileTool.md) | `feature('KAIROS')` |
| Skill | [SkillTool.md](./SkillTool.md) | 无条件（core） |
| Sleep | [SleepTool.md](./SleepTool.md) | `feature('PROACTIVE' \| 'KAIROS')` |
| Snip | [SnipTool.md](./SnipTool.md) | `feature('HISTORY_SNIP')` |
| SubscribePR | [SubscribePRTool.md](./SubscribePRTool.md) | `feature('KAIROS_GITHUB_WEBHOOKS')` |
| SuggestBackgroundPR | [SuggestBackgroundPRTool.md](./SuggestBackgroundPRTool.md) | `USER_TYPE === 'ant'` |
| SyntheticOutput | [SyntheticOutputTool.md](./SyntheticOutputTool.md) | 特殊：不进常规池（specialTools 过滤） |
| TaskCreate | [TaskCreateTool.md](./TaskCreateTool.md) | `isTodoV2Enabled()` |
| TaskGet | [TaskGetTool.md](./TaskGetTool.md) | `isTodoV2Enabled()` |
| TaskList | [TaskListTool.md](./TaskListTool.md) | `isTodoV2Enabled()` |
| TaskOutput | [TaskOutputTool.md](./TaskOutputTool.md) | 无条件（core） |
| TaskStop | [TaskStopTool.md](./TaskStopTool.md) | 无条件（core） |
| TaskUpdate | [TaskUpdateTool.md](./TaskUpdateTool.md) | `isTodoV2Enabled()` |
| TeamCreate | [TeamCreateTool.md](./TeamCreateTool.md) | 无条件（core） |
| TeamDelete | [TeamDeleteTool.md](./TeamDeleteTool.md) | 无条件（core） |
| TerminalCapture | [TerminalCaptureTool.md](./TerminalCaptureTool.md) | `feature('TERMINAL_PANEL')` |
| TodoWrite | [TodoWriteTool.md](./TodoWriteTool.md) | 无条件（core） |
| Tungsten | [TungstenTool.md](./TungstenTool.md) | `USER_TYPE === 'ant'` |
| VaultHttpFetch | [VaultHttpFetchTool.md](./VaultHttpFetchTool.md) | 无条件（core） |
| VerifyPlanExecution | [VerifyPlanExecutionTool.md](./VerifyPlanExecutionTool.md) | `env CLAUDE_CODE_VERIFY_PLAN === 'true'` |
| WebBrowser | [WebBrowserTool.md](./WebBrowserTool.md) | `feature('WEB_BROWSER_TOOL')` |
| WebFetch | [WebFetchTool.md](./WebFetchTool.md) | 无条件（core） |
| WebSearch | [WebSearchTool.md](./WebSearchTool.md) | 无条件（core） |
| Workflow | [WorkflowTool.md](./WorkflowTool.md) | `feature('WORKFLOW_SCRIPTS')`（定义在 `src/workflow/wiring.ts`，不在 builtin-tools） |

## 特殊说明

- **ScheduleCronTool 目录**实际导出 3 个工具（CronCreate/CronDelete/CronList），注册表中以 `cronTools` 数组整体注入。
- **SyntheticOutputTool** 在 `getTools()` 中被 specialTools 集合过滤（不进常规工具池），仅内部使用。
- **TestingPermissionTool**（`tools/testing/` 目录）仅 `NODE_ENV === 'test'` 注册，未单独出文档。
- **REPL 模式**下 REPL_ONLY_TOOLS 集合中的工具对模型隐藏（经 REPL 间接使用），见 REPLTool.md。
- **embedded 构建**（ant-native，bfs/ugrep 嵌入 bun 二进制）会移除 Glob/Grep 两个独立工具。
