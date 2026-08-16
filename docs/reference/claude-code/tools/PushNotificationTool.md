# PushNotificationTool

- **工具名**: `PushNotification`（userFacingName: `Notify`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/PushNotificationTool/`
- **门槛**: `feature('KAIROS') || feature('KAIROS_PUSH_NOTIFICATION')`（`vendor/claude-code/src/tools.ts` 第 51–54 行）；另有 `isEnabled()` 运行时检查 `isBridgeEnabled()`（Remote Control bridge 已配置才启用）
- **性质**: 只读（`isReadOnly: true`——不修改项目状态）；并发安全（`isConcurrencySafe: true`）；`strict: true`

## 描述（模型侧 desc）

`description()` 返回（定义于 `PushNotificationTool.ts` 的 `buildTool` 中）：

```
Send a push notification to the user's mobile device
```

`prompt()` 返回（同文件 `buildTool` 中内联文本）：

```
Send a push notification to the user's mobile device via Remote Control.

Use this when:
- A long-running task completes and the user may not be watching
- A permission prompt is waiting and you need user input
- Something urgent requires the user's attention

Requires Remote Control to be configured. Respects user notification settings (taskCompleteNotifEnabled, inputNeededNotifEnabled, agentPushNotifEnabled).
```

## Input Schema

- `title` (string, 必填): "Title of the push notification."
- `body` (string, 必填): "Body text of the push notification."
- `priority` (enum `normal` | `high`, 可选): "Notification priority. Use \"high\" for blockers or permission prompts."
