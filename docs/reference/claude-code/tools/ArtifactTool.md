# ArtifactTool

- **工具名**: `artifact`（userFacingName: `Artifact`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/ArtifactTool/`
- **门槛**: 无条件（但 `shouldDefer: true`——默认不进主工具列表，经 SearchExtraTools/ExecuteExtraTool 发现后调用）
- **性质**: isReadOnly: `false`；isConcurrencySafe: `false`；requiresUserInteraction: `true`；`strict: true`
- **searchHint**: `'upload html markdown artifact share url cloud publish progress report public link'`

## 描述（模型侧 desc）

`description()` 返回 `describeArtifactTool()`：

```
Upload an HTML or Markdown file to the cloud-artifacts hosting service and get back a public URL. Markdown files are converted to styled HTML before upload. Pass `hash` to overwrite a previously-uploaded artifact (keeps URL stable).
```

`prompt()` 返回 `getArtifactToolPrompt()`：

```
Upload an HTML or Markdown file to a public hosting service and return a shareable URL plus an internal `id` (the "hash").

## Inputs
- `file_path` (required): absolute path to a local HTML (`.html`/`.htm`) or Markdown (`.md`/`.markdown`) file. Markdown is converted to a styled HTML document before upload — just author plain Markdown (headings, lists, GFM tables, fenced code blocks, blockquotes) and the tool wraps it in a page with a neutral stylesheet.
- `hash` (optional): if provided, overwrites the artifact with the same hash (URL stays the same). If omitted, a new random id is generated.
- `ttl` (optional, default `7`): artifact lifetime in days. Must be `7` or `30`.

## Output
`{ id, url, expiresAt }` — `id` is the hash (save it for future overwrite calls), `url` is publicly accessible.

## Workflow
1. Use the Write tool to create a local `.html` or `.md` file.
2. Call this tool with its `file_path`.
3. If iterating on the same artifact, pass back the `id` returned from the first call as `hash` so the URL stays stable.

## Errors
The tool surfaces backend error codes verbatim (e.g. `payload_too_large`, `unauthorized`). If the file does not exist, is not a regular file, or has an unsupported extension, the tool returns an `error` field without making an HTTP request. Accepted extensions: `.html`, `.htm`, `.md`, `.markdown`.
```

## Input Schema

- `file_path` (string, 必填): "Absolute path to a local HTML (.html/.htm) or Markdown (.md/.markdown) file to upload. Markdown is converted to styled HTML before upload."
- `hash` (string, 可选, regex `^[A-Za-z0-9_-]{1,128}$`): "If provided, overwrites the existing artifact with this hash (URL stays stable). If omitted, a new random id is generated."
- `ttl` (union `7|30`, 默认 `7`): "Lifetime in days. Must be 7 or 30. Default 7."
