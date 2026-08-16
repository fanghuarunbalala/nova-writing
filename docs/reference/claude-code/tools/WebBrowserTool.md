# WebBrowserTool

- **工具名**: `WebBrowser`（userFacingName: `Browser`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/WebBrowserTool/`
- **门槛**: `feature('WEB_BROWSER_TOOL')`
- **性质**: 只读（isReadOnly: true）、非并发安全（isConcurrencySafe: false）

## 描述（模型侧 desc）

来源：`WebBrowserTool.ts` 内联。`description()` 返回：

```text
Fetch and read web page content via HTTP
```

`prompt()` 返回：

```text
Fetch web pages via HTTP and extract their text content. This is a lightweight browser tool (HTTP fetch, not a full browser engine).

Supported actions:
- navigate: Fetch a URL and extract page title + text content
- screenshot: Same as navigate (returns text snapshot, not a visual screenshot)

Limitations:
- No JavaScript execution — only sees server-rendered HTML
- click/type/scroll require a full browser runtime (not available)
- For full browser interaction, use the Claude-in-Chrome MCP tools instead

Use this for:
- Reading web page content and documentation
- Checking API endpoints that return HTML
- Quick page title/content extraction
```

## Input Schema

- `url` (string, 必填): "URL to fetch and extract content from."
- `action` (enum `navigate` | `screenshot`, 可选): "Action to perform. \"navigate\" fetches page content (default). \"screenshot\" returns a text snapshot of the page."
