# ConfigTool

- **工具名**: `Config`（userFacingName: `Config`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/ConfigTool/`
- **门槛**: `process.env.USER_TYPE === 'ant'`（`getAllBaseTools` 中仅 ant 用户注册；`shouldDefer: true`）
- **性质**: isReadOnly(input): 动态——`input.value === undefined` 时为 `true`（读取自动放行）；isConcurrencySafe: `true`
- **searchHint**: `'get or set Claude Code settings (theme, model)'`

## 描述（模型侧 desc）

`description()` 返回 `DESCRIPTION`：

```
Get or set Claude Code configuration settings.
```

`prompt()` 返回 `generatePrompt()`——由 `SUPPORTED_SETTINGS` 注册表动态拼装（setting 清单随 feature 开关变化）。以下为按「默认 feature 基线」（`AUTO_THEME` 关、`TRANSCRIPT_CLASSIFIER` 开、`VOICE_MODE`/`BRIDGE_MODE`/`KAIROS` 关、非 ant、模型选项动态）拼装后的最终文本（变量已替换）：

```
Get or set Claude Code configuration settings.

  View or change Claude Code settings. Use when the user requests configuration changes, asks about current settings, or when adjusting a setting would benefit them.


## Usage
- **Get current value:** Omit the "value" parameter
- **Set new value:** Include the "value" parameter

## Configurable settings list
The following settings are available for you to change:

### Global Settings (stored in ~/.claude.json)
- theme: "dark", "light", "light-daltonized", "dark-daltonized", "light-ansi", "dark-ansi" - Color theme for the UI
- editorMode: "normal", "vim" - Key binding mode
- verbose: true/false - Show detailed debug output
- preferredNotifChannel: "auto", "iterm2", "iterm2_with_bell", "terminal_bell", "kitty", "ghostty", "notifications_disabled" - Preferred notification channel
- autoCompactEnabled: true/false - Auto-compact when context is full
- fileCheckpointingEnabled: true/false - Enable file checkpointing for code rewind
- showTurnDuration: true/false - Show turn duration message after responses (e.g., "Cooked for 1m 6s")
- terminalProgressBarEnabled: true/false - Show OSC 9;4 progress indicator in supported terminals
- todoFeatureEnabled: true/false - Enable todo/task tracking
- teammateMode: "auto", "tmux", "in-process" - How to spawn teammates: "tmux" for traditional tmux, "in-process" for same process, "auto" to choose automatically

### Project Settings (stored in settings.json)
- autoMemoryEnabled: true/false - Enable auto-memory
- autoDreamEnabled: true/false - Enable background memory consolidation
- alwaysThinkingEnabled: true/false - Enable extended thinking (false to disable)
- permissions.defaultMode: "default", "plan", "acceptEdits", "dontAsk", "auto" - Default permission mode for tool usage
- language - Preferred language for Claude responses and voice dictation (e.g., "japanese", "spanish")

## Model
- model - Override the default model. Available options:
  - <value>: <description>   ← 由 getModelOptions() 动态生成，无 options 时回退
## Examples
- Get theme: { "setting": "theme" }
- Set dark theme: { "setting": "theme", "value": "dark" }
- Enable vim mode: { "setting": "editorMode", "value": "vim" }
- Enable verbose: { "setting": "verbose", "value": true }
- Change model: { "setting": "model", "value": "opus" }
- Change permission mode: { "setting": "permissions.defaultMode", "value": "plan" }
```

**条件拼接段**：

1. `AUTO_THEME` feature 开启时，theme 的选项为 `THEME_SETTINGS`（`"auto", "dark", "light", "light-daltonized", "dark-daltonized", "light-ansi", "dark-ansi"`），否则为 `THEME_NAMES`（无 `auto`）。
2. `TRANSCRIPT_CLASSIFIER` feature 关闭时，`permissions.defaultMode` 选项为 `"default", "plan", "acceptEdits", "dontAsk"`（无 `auto`）。
3. ant 用户追加 project setting：`- classifierPermissionsEnabled: true/false - Enable AI-based classification for Bash(prompt:...) permission rules`
4. `VOICE_MODE` feature 开启且 voice 未被 GrowthBook kill-switch 关闭时追加：`- voiceEnabled: true/false - Enable voice dictation (hold-to-talk)`
5. `BRIDGE_MODE` feature 开启时追加 global setting：`- remoteControlAtStartup: true/false - Enable Remote Control for all sessions (true | false | default)`
6. `KAIROS` 或 `KAIROS_PUSH_NOTIFICATION` 开启时追加三条 global setting：
   `- taskCompleteNotifEnabled: true/false - Push to your mobile device when idle after Claude finishes (requires Remote Control)`、
   `- inputNeededNotifEnabled: true/false - Push to your mobile device when a permission prompt or question is waiting (requires Remote Control)`、
   `- agentPushNotifEnabled: true/false - Allow Claude to push to your mobile device when it deems it appropriate (requires Remote Control)`
7. 模型选项行由 `getModelOptions()` 生成：`  - <value>: <descriptionForModel ?? description>`（value 为 null 时显示 `null/"default"`）；该调用抛错时回退为：

   ```
   ## Model
   - model - Override the default model (sonnet, opus, haiku, best, or full model ID)
   ```

## Input Schema

- `setting` (string, 必填): "The setting key (e.g., \"theme\", \"model\", \"permissions.defaultMode\")"
- `value` (union string|boolean|number, 可选): "The new value. Omit to get current value."
