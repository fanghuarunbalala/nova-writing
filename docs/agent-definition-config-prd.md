# Agent Definition 配置化（已落地说明）

> 对应规划文档：`docs/PRD/agent-definition-config.md`
> 分支：`feat/agent-definition-config`

## 1. 背景与目标

原 `buildNovelAgent` 硬编码 6 段 system 数组 + 7 组工具工厂 + 内联 find 分发，且存在一个真实 bug：`LoopContext` 的 `staticSystemCache` 为单字符串缓存，首个 static 段渲染后后续 static 段全部被首段内容替换（novel 4 段从未进入 system prompt）。

**目标**：对齐 legacy 声明式配置风格（「配置项优美、可展示」），agent 组装改为**声明式定义 + 装配器解析**，并修复缓存 bug。

## 2. 配置模型（三层）

| 层 | 类型 | 说明 |
|---|---|---|
| agent 级 | `AgentDefinition` | 纯声明、不可变、校验 + 冻结 + `toSnapshot()`：agentType / definitionVersion / label / description / promptRecipe / tools / delegation / communication / runtimePolicyId / nudgeEnablement |
| 段级 | `PromptSection`（判别联合）+ `PromptSectionRegistry` | `kind` 与渲染方法绑定：static 只实现 `render(ctx)`，dynamic 只实现 `renderDynamic(input, ctx)`；注册表 `id@version` 唯一，未指定版本解析最新版（semver 排序） |
| 工具组级 | `ToolGroupManifest` | 展示层（id/version/label/description/tools 有序唯一）；工具本体由组工厂按 manifest.tools 名称解析 |

- `PromptRecipe`：有序条目（`PromptSectionItem` 可选版本锁定 / `InlinePromptItem` ≤1024 字符非空），1..64 条目、段引用 id 唯一。
- `AgentAssembler`：`resolveRecipe`（recipe 序 + static-before-dynamic 校验）/ `resolveTools`（组序展开 + allow/deny 过滤）/ `resolveNudges`（enabled ∩ 目录）。

## 3. novel 实例（`definitions/NovelAgentDefinition.ts`）

```
agentType: "novel", definitionVersion: "1.0.0", label: "Novel Agent"
delegation: subagent[novel_explorer, novel_compose]   # 声明保留、运行时零效果
communication: standalone
nudgeEnablement: [compose_mode, todo_idle]
recipe: 9 段（6 static 全前 + 3 dynamic 后）
tools: 8 组 21 工具
```

## 4. 组装顺序（recipe 序，最终 system prompt）

| 序 | 段 id | kind | 内容 |
|---|---|---|---|
| 1 | `novel.identity` | static | 身份与创作定位 |
| 2 | `novel.system` | static | 系统与运行规则 |
| 3 | `novel.doing-tasks` | static | 创作任务 |
| 4 | `novel.actions` | static | 谨慎行动 |
| 5 | `novel.communication` | static | 交流风格（legacy 中文文案） |
| 6 | `core.runtime.protocol` | static | 运行时协议 |
| 7 | `core.environment` | dynamic | 环境信息块（每调用） |
| 8 | `novel.global_constraints` | dynamic | NOVEL.md 注入（每调用） |
| 9 | `tool.guidance` | dynamic | 可用工具清单（每调用） |
| 尾 | — | — | 每工具 `# ToolPolicy` 追加（promptDetail.policy） |

## 5. 动态段机制

- **渲染模型**：static 段一次渲染进 base 缓存（`renderStaticBase`，修复缓存短路）；dynamic 段每 provider call 渲染，空串整段省略；`systemPrompt` getter 返回**最近一次渲染值**（未渲染时以空输入渲染）。
- **输入通道**：`LoopContext` 构造注入 `DynamicInputProvider = () => Promise<DynamicPromptSectionInput>`，`toProviderCall`（async）每调用取宿主输入：
  - `environment.workdir/platform`：node 层（子进程 entrypoint）注入；
  - `environment.modelId`：LoopContext 以 `run.sampling.model` 补齐；
  - `novelGlobalConstraints`：node 层 `readNovelGlobalConstraintsSafe` 每调用读取 `NOVEL.md`（≤256 KiB，缺失/非文件/超限/失败静默 undefined）。
  - prompt 层不接触 `node:fs`。
- **各段行为**：
  - `core.environment`：workdir/platform 为空整段省略；否则「日期（现场计算）+ 时区（Intl 现场解析）+ platform + workdir + modelId」。
  - `novel.global_constraints`：常驻说明恒渲染；文件内容 `<Novel-Constraints-Content>` 包裹；无内容渲染占位提示。
  - `tool.guidance`：恒渲染工具清单（只消费 ctx）；新架构无 promptDetails 注入面，它是工具可见性唯一通道。

## 6. nudge 语义

- 生效集 = `definition.nudgeEnablement.enabled` ∩ **nudge 实现目录**（`buildNovelAgent` 组装 catalog，按 enabled 声明序实例化）。
- `todo_idle` 恒可注入（TodoWrite 已装配为 `runtime.todo` 组，缺省 `InMemoryConversationTodoStore`）。
- `compose_mode` 需 `composeState`（entrypoint 传 `ComposeModeStateProvider` 实例；compose 状态机接线不在本期，无 transition 时该 nudge 休眠）。
- legacy 语义为 ∩ 工具组守卫，新架构简化为 ∩ 实现目录。

## 7. 范围外

snapshot/hydrator/manifest digest、subagent 运行时装配（delegation 仅声明）、compose 状态机接线、`PromptCapabilitySnapshot` 注入面、legacy 其余 4 个 compose nudge（pending/reentry/exit/sparse）。

## 8. 验收

- 每步 commit 全绿：`cd core && pnpm test`（47 文件 257 用例）+ `pnpm typecheck`。
- 端到端渲染回归（`agent-render-e2e.test.ts`）：9 段标记按 recipe 序、各恰好一次（锁死缓存 bug）；动态输入注入断言；工具清单 21 项 + ToolPolicy 追加。
- 人工确认（需 token）：`node core/scripts/novel-agent-smoke.mjs`（真实 prompt 含 9 段）、`conversation-stdio-child.mjs`（注入路径）。
