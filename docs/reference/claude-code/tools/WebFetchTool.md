# WebFetchTool

- **工具名**: `WebFetch`（userFacingName: `Fetch`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/WebFetchTool/`
- **门槛**: 无条件（getAllBaseTools 直接列出）
- **性质**: 只读（isReadOnly: true）、并发安全（isConcurrencySafe: true）

## 描述（模型侧 desc）

`description(input)` 为动态模板（来源：`WebFetchTool.ts` 内联）：

```text
Claude wants to fetch content from ${hostname}
```

其中 `${hostname}` 为输入 URL 解析出的主机名；URL 解析失败时返回 `Claude wants to fetch content from this URL`。

`prompt()` 返回 `prompt.ts` 的 `DESCRIPTION` 常量：

```text

- Fetches content from a specified URL and processes it using an AI model
- Takes a URL and a prompt as input
- Fetches the URL content, converts HTML to markdown
- Processes the content with the prompt using a small, fast model
- Returns the model's response about the content
- Use this tool when you need to retrieve and analyze web content

Usage notes:
  - IMPORTANT: If an MCP-provided web fetch tool is available, prefer using that tool instead of this one, as it may have fewer restrictions.
  - The URL must be a fully-formed valid URL
  - HTTP URLs will be automatically upgraded to HTTPS
  - The prompt should describe what information you want to extract from the page
  - This tool is read-only and does not modify any files
  - Results may be summarized if the content is very large
  - Includes a self-cleaning 15-minute cache for faster responses when repeatedly accessing the same URL
  - When a URL redirects to a different host, the tool will inform you and provide the redirect URL in a special format. You should then make a new WebFetch request with the redirect URL to fetch the content.
  - For GitHub URLs, prefer using the gh CLI via Bash instead (e.g., gh pr view, gh issue view, gh api).
```

## Input Schema

- `url` (string, 必填, 需为合法 URL): "The URL to fetch content from"
- `prompt` (string, 必填): "The prompt to run on the fetched content"

## 附加模型侧内容

来源：`prompt.ts` 的 `makeSecondaryModelPrompt()` —— 处理抓取内容的二级模型所见的拼装提示词（预批准域名与非预批准域名两个变体）：

```text
Web page content:
---
${markdownContent}
---

${prompt}

Provide a concise response based on the content above. Include relevant details, code examples, and documentation excerpts as needed.
```

非预批准域名时 `guidelines` 为：

```text
Provide a concise response based only on the content above. In your response:
 - Enforce a strict 125-character maximum for quotes from any source document. Open Source Software is ok as long as we respect the license.
 - Use quotation marks for exact language from articles; any language outside of the quotation should never be word-for-word the same.
 - You are not a lawyer and never comment on the legality of your own prompts and responses.
 - Never produce or reproduce exact song lyrics.
```
