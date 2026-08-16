# TungstenTool

- **工具名**: `TungstenTool`（无 userFacingName）
- **源码**: `vendor/claude-code/packages/builtin-tools/src/tools/TungstenTool/`
- **门槛**: `process.env.USER_TYPE === 'ant'`（getAllBaseTools 中的条件）

## 描述（模型侧 desc）

本 vendor 副本中 TungstenTool 为**占位 stub**，无模型侧描述、无 input schema：

- `TungstenTool.js`（打包产物）：

```js
export const TungstenTool = {
  name: 'TungstenTool',
  isEnabled: () => false,
}
```

- `TungstenTool.ts`（源码 stub）：

```ts
// Auto-generated stub — replace with real implementation
export const TungstenTool: Tool = (() => {}) as unknown as Tool
export const clearSessionsWithTungstenUsage: () => void = () => {}
export const resetInitializationState: () => void = () => {}
```

同目录另有 `TungstenLiveMonitor.ts`（运行时监控，非工具契约）。

## Input Schema

无（stub 未定义 inputSchema）。
