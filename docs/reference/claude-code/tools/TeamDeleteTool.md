# TeamDeleteTool

- **工具名**: `TeamDelete`（userFacingName: `''`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/TeamDeleteTool/`
- **门槛**: 无条件（getAllBaseTools 直接列出）；`isEnabled()`: `true`

## 描述（模型侧 desc）

来源：`TeamDeleteTool.ts` 内联。`description()` 返回：

```text
Clean up team and task directories when the swarm is complete
```

`prompt()` 返回 `prompt.ts` 中 `getPrompt()` 的最终文本：

```text
# TeamDelete

Remove team and task directories when the swarm work is complete.

This operation:
- Removes the team directory (`~/.claude/teams/{team-name}/`)
- Removes the task directory (`~/.claude/tasks/{team-name}/`)
- Clears team context from the current session

**IMPORTANT**: TeamDelete will fail if the team still has active members. Gracefully terminate teammates first, then call TeamDelete after all teammates have shut down.

Use this when all teammates have finished their work and you want to clean up the team resources. The team name is automatically determined from the current session's team context.
```

## Input Schema

- `wait_ms` (number, 可选, min 0 / max 30000): "Optional time to wait for active teammates to acknowledge shutdown before cleanup."
