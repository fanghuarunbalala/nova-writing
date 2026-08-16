# AskUserQuestionTool

- **工具名**: `AskUserQuestion`（userFacingName: `''`（空字符串））
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/AskUserQuestionTool/`
- **门槛**: 无条件（`shouldDefer: true`；`isEnabled()` 在 `--channels` 激活（`KAIROS`/`KAIROS_CHANNELS` 且 `getAllowedChannels().length > 0`）时返回 `false`）
- **性质**: isReadOnly: `true`；isConcurrencySafe: `true`
- **searchHint**: `'prompt the user with a multiple-choice question'`

## 描述（模型侧 desc）

`description()` 返回 `DESCRIPTION`：

```
Asks the user multiple choice questions to gather information, clarify ambiguity, understand preferences, make decisions or offer them choices.
```

`prompt()` 返回 `ASK_USER_QUESTION_TOOL_PROMPT`（`${EXIT_PLAN_MODE_TOOL_NAME}` 已替换为 `ExitPlanMode`）；若 `getQuestionPreviewFormat()` 非 undefined（SDK 消费者已启用 preview 格式），再拼接对应的 `PREVIEW_FEATURE_PROMPT`（见「附加模型侧内容」）：

```
Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- Users will always be able to select "Other" to provide custom text input
- Use multiSelect: true to allow multiple answers to be selected for a question
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label

Plan mode note: In plan mode, use this tool to clarify requirements or choose between approaches BEFORE finalizing your plan. Do NOT use this tool to ask "Is my plan ready?" or "Should I proceed?" - use ExitPlanMode for plan approval. IMPORTANT: Do not reference "the plan" in your questions (e.g., "Do you have feedback about the plan?", "Does the plan look good?") because the user cannot see the plan in the UI until you call ExitPlanMode. If you need plan approval, use ExitPlanMode instead.
```

## Input Schema

- `questions` (array, 1-4 项, 必填): "Questions to ask the user (1-4 questions)"。每项：
  - `question` (string, 必填): "The complete question to ask the user. Should be clear, specific, and end with a question mark. Example: \"Which library should we use for date formatting?\" If multiSelect is true, phrase it accordingly, e.g. \"Which features do you want to enable?\""
  - `header` (string, 必填): "Very short label displayed as a chip/tag (max 12 chars). Examples: \"Auth method\", \"Library\", \"Approach\"."
  - `options` (array, 2-4 项, 必填): "The available choices for this question. Must have 2-4 options. Each option should be a distinct, mutually exclusive choice (unless multiSelect is enabled). There should be no 'Other' option, that will be provided automatically." 每项：
    - `label` (string, 必填): "The display text for this option that the user will see and select. Should be concise (1-5 words) and clearly describe the choice."
    - `description` (string, 必填): "Explanation of what this option means or what will happen if chosen. Useful for providing context about trade-offs or implications."
    - `preview` (string, 可选): "Optional preview content rendered when this option is focused. Use for mockups, code snippets, or visual comparisons that help users compare options. See the tool description for the expected content format."
  - `multiSelect` (boolean, 默认 `false`): "Set to true to allow the user to select multiple options instead of just one. Use when choices are not mutually exclusive."
- `answers` (record<string, string>, 可选): "User answers collected by the permission component"
- `annotations` (record<string, annotation>, 可选): "Optional per-question annotations from the user (e.g., notes on preview selections). Keyed by question text." 每项 annotation：
  - `preview` (string, 可选): "The preview content of the selected option, if the question used previews."
  - `notes` (string, 可选): "Free-text notes the user added to their selection."
- `metadata` (object, 可选): "Optional metadata for tracking and analytics purposes. Not displayed to user."
  - `metadata.source` (string, 可选): "Optional identifier for the source of this question (e.g., \"remember\" for /remember command). Used for analytics tracking."

顶层 refine 约束：`Question texts must be unique, option labels must be unique within each question`。

## 附加模型侧内容

`PREVIEW_FEATURE_PROMPT`（来源 `AskUserQuestionTool/prompt.ts`；按 preview 格式二选一拼接在 prompt 末尾）：

**markdown 格式**：

```
Preview feature:
Use the optional `preview` field on options when presenting concrete artifacts that users need to visually compare:
- ASCII mockups of UI layouts or components
- Code snippets showing different implementations
- Diagram variations
- Configuration examples

Preview content is rendered as markdown in a monospace box. Multi-line text with newlines is supported. When any option has a preview, the UI switches to a side-by-side layout with a vertical option list on the left and preview on the right. Do not use previews for simple preference questions where labels and descriptions suffice. Note: previews are only supported for single-select questions (not multiSelect).
```

**html 格式**：

```
Preview feature:
Use the optional `preview` field on options when presenting concrete artifacts that users need to visually compare:
- HTML mockups of UI layouts or components
- Formatted code snippets showing different implementations
- Visual comparisons or diagrams

Preview content must be a self-contained HTML fragment (no <html>/<body> wrapper, no <script> or <style> tags — use inline style attributes instead). Do not use previews for simple preference questions where labels and descriptions suffice. Note: previews are only supported for single-select questions (not multiSelect).
```
