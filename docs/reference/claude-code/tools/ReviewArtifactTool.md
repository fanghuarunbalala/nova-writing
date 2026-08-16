# ReviewArtifactTool

- **工具名**: `ReviewArtifact`（userFacingName: `ReviewArtifact`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/ReviewArtifactTool/`
- **门槛**: `feature('REVIEW_ARTIFACT')`（tools.ts 顶层条件加载，getAllBaseTools 中条件展开）
- **性质**: 并发安全（`isConcurrencySafe() → true`）；只读（`isReadOnly() → true`）

## 描述（模型侧 desc）

本工具无独立 prompt.ts；描述为函数拼装（ReviewArtifactTool.ts 内联）。常量 `DESCRIPTION`：

```
Review an artifact (code snippet, document, or other content) with inline annotations and feedback.
```

`description(input)` 为动态函数，按输入 `title` 拼装：

```
title ? `Claude wants to review: ${title}` : 'Claude wants to review an artifact'
```

模型侧 prompt（`prompt()`，ReviewArtifactTool.ts 内联，尾部拼接 `DESCRIPTION` 常量）：

```
Use this tool to present a review of a code snippet, document, or other artifact with inline annotations and feedback. Each annotation can target a specific line and include a severity level. Review an artifact (code snippet, document, or other content) with inline annotations and feedback.
```

## Input Schema

- `artifact` (string, 必填): "The content of the artifact to review (code snippet, document text, etc.)."
- `title` (string, 可选): "Optional title or file path for the artifact being reviewed."
- `annotations` (array, 必填): "List of annotations/comments on the artifact."，元素为 object：
  - `line` (number, 可选): "Line number for the annotation (1-based)."
  - `message` (string, 必填): "The annotation or feedback message."
  - `severity` (enum: `'info' | 'warning' | 'error' | 'suggestion'`, 可选): "Severity level of the annotation."
- `summary` (string, 可选): "An overall summary of the review."
