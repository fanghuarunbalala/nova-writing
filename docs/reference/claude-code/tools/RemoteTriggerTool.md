# RemoteTriggerTool

- **工具名**: `RemoteTrigger`（userFacingName: 未显式定义，buildTool 默认回退为 name，即 `RemoteTrigger`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/RemoteTriggerTool/`
- **门槛**: `feature('AGENT_TRIGGERS_REMOTE')`（tools.ts 顶层 `const RemoteTriggerTool = feature('AGENT_TRIGGERS_REMOTE') ? require(...) : null`，getAllBaseTools 中条件展开）。另有运行时 `isEnabled()`：`getFeatureValue_CACHED_MAY_BE_STALE('tengu_surreal_dali', false) && isPolicyAllowed('allow_remote_sessions')`
- **性质**: 并发安全（`isConcurrencySafe() → true`）；`isReadOnly(input)` 仅当 `action` 为 `list` 或 `get`；`shouldDefer: true`

## 描述（模型侧 desc）

`description()` 返回常量 `DESCRIPTION`（prompt.ts）：

```
Manage scheduled remote Claude Code agents (triggers) via the claude.ai CCR API. Auth is handled in-process — the token never reaches the shell.
```

模型侧 prompt（`prompt()` 返回 `PROMPT` 常量，prompt.ts）：

```
Call the claude.ai remote-trigger API. Use this instead of curl — the OAuth token is added automatically in-process and never exposed.

Actions:
- list: GET /v1/code/triggers
- get: GET /v1/code/triggers/{trigger_id}
- create: POST /v1/code/triggers (requires body)
- update: POST /v1/code/triggers/{trigger_id} (requires body, partial update)
- run: POST /v1/code/triggers/{trigger_id}/run

The response is the raw JSON from the API.
```

## Input Schema

- `action` (enum: `'list' | 'get' | 'create' | 'update' | 'run'`, 必填): 无 `.describe()`
- `trigger_id` (string, 可选；regex `/^[\w-]+$/`): "Required for get, update, and run"
- `body` (record(string, unknown), 可选): "JSON body for create and update"
