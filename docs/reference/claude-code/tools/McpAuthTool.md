# McpAuthTool

- **工具名**: `mcp__<serverName>__authenticate`（动态，由 `buildMcpToolName(serverName, 'authenticate')` 生成；userFacingName: `<serverName> - authenticate (MCP)`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/McpAuthTool/`
- **门槛**: 未注册在 getAllBaseTools（deferred/内部工具）。由 `vendor/claude-code/src/services/mcp/client.ts` 的 `createMcpAuthTool(name, config)` 在 MCP 服务器处于 `needs-auth` 状态（连接 401 / 有 discovery 但无 token 的缓存 needs-auth）时按服务器动态创建，替代该服务器的真实工具注入模型上下文；OAuth 完成后被前缀替换机制（`mcp__<server>__*`）自动移除
- **性质**: 非只读（`isReadOnly: false`）；非并发安全（`isConcurrencySafe: false`）

## 描述（模型侧 desc）

无 `prompt.ts`。`description()` 与 `prompt()` 均返回 `createMcpAuthTool` 内按服务器拼装的同一文本（变量已替换为占位说明）：

```
The `<serverName>` MCP server (<transport> at <url> 或 <transport>) is installed but requires authentication. Call this tool to start the OAuth flow — you'll receive an authorization URL to share with the user. Once the user completes authorization in their browser, the server's real tools will become available automatically.
```

（原文拼装：`` The \`${serverName}\` MCP server (${location}) is installed but requires authentication. `` + `` Call this tool to start the OAuth flow — you'll receive an authorization URL to share with the user. `` + `` Once the user completes authorization in their browser, the server's real tools will become available automatically. ``，其中 `location = url ? \`${transport} at ${url}\` : transport`，`transport = config.type ?? 'stdio'`）

## Input Schema

空对象 `z.object({})`，无字段。
