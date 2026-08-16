# SyntheticOutputTool

- **工具名**: `StructuredOutput`（`SYNTHETIC_OUTPUT_TOOL_NAME`；userFacingName: 未显式定义，buildTool 默认回退为 name，即 `StructuredOutput`）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/SyntheticOutputTool/`
- **门槛**: 未注册在 getAllBaseTools（特殊工具：在 `getTools()` 过滤后由调用方动态注入，见 main.tsx `createSyntheticOutputTool(jsonSchema)` 追加逻辑；创建门槛为 `isSyntheticOutputToolEnabled({ isNonInteractiveSession })`，即非交互会话/SDK-CLI 场景）。创建成功后 `isEnabled() → true`
- **性质**: 并发安全（`isConcurrencySafe() → true`）；只读（`isReadOnly() → true`）；`isOpenWorld() → false`

## 描述（模型侧 desc）

`description()`（SyntheticOutputTool.ts 内联）：

```
Return structured output in the requested format
```

模型侧 prompt（`prompt()`，SyntheticOutputTool.ts 内联）：

```
Use this tool to return your final response in the requested structured format. You MUST call this tool exactly once at the end of your response to provide the structured output.
```

## Input Schema

基础定义：`z.object({}).passthrough()` —— 接受任意对象，无固定字段、无 `.describe()`。

实际对模型生效的 schema 是动态注入的：`createSyntheticOutputTool(jsonSchema)` 用调用方提供的 JSON schema（Ajv 校验后）覆盖 `inputJSONSchema`，即 SDK 传入的结构化输出 schema（例如 `{properties: {bugs: ...}}`）。调用时输入按该 schema 校验，不匹配则报错。
