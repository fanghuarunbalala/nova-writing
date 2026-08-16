# VaultHttpFetchTool

- **工具名**: `VaultHttpFetch`（userFacingName: `Vault HTTP`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/VaultHttpFetchTool/`
- **门槛**: 无条件（getAllBaseTools 直接列出）
- **性质**: 非只读（isReadOnly: false，网络副作用）、非并发安全（isConcurrencySafe: false）

## 描述（模型侧 desc）

来源：`prompt.ts`。`description()` 返回 `DESCRIPTION` 常量（字符串拼接后的最终文本）：

```text
Make an authenticated HTTPS request using a secret stored in the user's encrypted local vault (~/.claude/local-vault/). You only specify the vault key NAME — never the secret value. The tool framework injects the secret directly into a request header and the secret is NEVER returned in tool_result, NEVER logged, NEVER passed to a shell. Each vault key requires user pre-approval via permissions.allow: ['VaultHttpFetch(key-name)']. Whole-tool allow ('VaultHttpFetch' without parentheses) is rejected at settings parse time.
```

`prompt()` 返回 `PROMPT` 常量：

```text
VaultHttpFetch — authenticated HTTPS request with a vault-stored secret.

Use for: HTTP API calls that need a Bearer token, Basic auth, X-Api-Key, or
custom auth header. GitHub API, Stripe API, internal service auth, etc.

Do NOT use for: shell commands needing secrets (git push, npm publish, ssh,
docker login). Those are out of scope; the user must handle them externally.

Request schema:
  url             https:// only (HTTP/file/ftp rejected)
  method          GET (default), POST, PUT, PATCH, DELETE
  vault_auth_key  the vault key name (the secret value is fetched by the tool)
  auth_scheme     bearer (default), basic, header_x_api_key, custom
  auth_header_name when auth_scheme=custom, the HTTP header to use
  body            request body (string; sent as-is)
  body_content_type  defaults to application/json when body is set
  reason          why you need this — appears in the user's permission prompt

Response: { status, statusText, responseHeaders (sensitive headers redacted),
  body (scrubbed of any secret-derived strings), or error }

Permission model:
  Default: ask (user prompt). Approving once for a key sets a per-key allow
  the user can persist via the prompt UI. Whole-tool allow is forbidden.

Always pass `reason` truthfully. The secret never appears in your context;
the URL, method, key NAME, and reason all do appear in the transcript.
```

## Input Schema

- `url` (string, 必填): "Target URL. Must be https://. Other schemes rejected."
- `method` (enum `GET` | `POST` | `PUT` | `PATCH` | `DELETE`, 可选, 默认 `GET`): "HTTP method"
- `vault_auth_key` (string, 必填, min 1 / max 128): "Vault key NAME (not the secret value). Per-key allow required."
- `auth_scheme` (enum `bearer` | `basic` | `header_x_api_key` | `custom`, 可选, 默认 `bearer`): "How to inject the secret: bearer = 'Authorization: Bearer X'; basic = 'Authorization: Basic base64(X)'; header_x_api_key = 'X-Api-Key: X'; custom = use auth_header_name with raw secret value."
- `auth_header_name` (string, 可选, regex `^[A-Za-z0-9_-]{1,64}$`): "When auth_scheme=custom, the HTTP header name for the secret value. Must match [A-Za-z0-9_-]{1,64}."
- `body` (string, 可选, max 1048576): "Request body"
- `body_content_type` (string, 可选, max 128): "Content-Type for the request body. Defaults to application/json."
- `reason` (string, 必填, min 1 / max 500): "Why you need this. Appears in the user permission prompt and audit log."
