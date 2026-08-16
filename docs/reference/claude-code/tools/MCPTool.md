# MCPTool

- **工具名**: 基座定义 `mcp`（userFacingName: `mcp`）；实际每个 MCP 服务器工具一个实例，名字为 `mcp__<server>__<tool>`（SDK 服务器且 `CLAUDE_AGENT_SDK_MCP_NO_PREFIX` 为真时用原始工具名）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/MCPTool/`
- **门槛**: 未注册在 getAllBaseTools（deferred/内部工具）。`vendor/claude-code/src/services/mcp/client.ts` 对每个已连接 MCP 服务器执行 `tools/list` 后，为每个远端工具生成一个 `{...MCPTool, ...}` 实例（第 1782 行起），注入模型工具池
- **性质**: `isMcp: true`；基座 `isOpenWorld: false`（每实例被 server 声明的 `openWorldHint` 覆盖）；`isReadOnly`/`isConcurrencySafe` 每实例取自 `tool.annotations.readOnlyHint`；`isDestructive` 取自 `destructiveHint`

## 描述（模型侧 desc）

`prompt.ts` 中 `PROMPT` 与 `DESCRIPTION` 均为空字符串（`''`）——基座无内容，注释说明「Actual prompt and description are overridden in mcpClient.ts」。

每实例覆盖（`vendor/claude-code/src/services/mcp/client.ts`）：
- `description()` 返回 `tool.description ?? ''`（服务器声明原文）
- `prompt()` 返回服务器 `tool.description`，超过 `MAX_MCP_DESCRIPTION_LENGTH` 时截断并追加 `… [truncated]`
- `searchHint` 取自 `tool._meta['anthropic/searchHint']`（空白折叠为单空格）；`alwaysLoad` 取自 `tool._meta['anthropic/alwaysLoad']`

## Input Schema

基座 schema（`MCPTool.ts` 第 14 行）：

```
z.object({}).passthrough()
```

即任意输入对象全部放行——注释：「Allow any input object since MCP tools define their own schemas」。每实例的模型侧 schema 由 `inputJSONSchema: tool.inputSchema` 覆盖为服务器 `tools/list` 返回的 JSON Schema。

## 附加模型侧内容（如有）

系统提示词中的 MCP 服务器指令段（`vendor/claude-code/src/constants/prompts.ts` 第 565–569 行，`getMcpInstructions()`，dynamic section `mcp_instructions`，仅当有已连接且声明了 `instructions` 的 MCP 服务器时注入）：

```
# MCP Server Instructions

The following MCP servers have provided instructions for how to use their tools and resources:

## <server name>
<该服务器的 instructions 原文>
```
