# Agent Definition 配置化重构 PRD

> 分支：`feat/agent-definition-config`（自 main 切出）
> 状态：待确认（确认后按 §11 分步实施，每步一个 commit）

## 1. 背景与目标

当前 main agent 的组装（`core/src/runtime/agent/NovelAgent.ts`）是**硬编码**的：

- 6 段 system 数组手写内联（`buildNovelAgent` 第 77–89 行）；
- 7 组工具工厂逐个 spread（第 68–76 行）；
- 工具调度是内联 `find` 线性查找（第 90–96 行）；
- nudge 空数组（compose nudge 由 Conversation 层注入，已实现的 `compose_mode`/`todo_idle` 未接线）；
- `runtime/registry/` 的 `InMemoryRegistry`/`Registry`/`AgentRegistry` 生产零调用（可删）。

**目标**：对齐 legacy（`origin/legacy-main`）的声明式配置风格——`NovelAgentDefinition.ts` / `AgentDefinition.ts` 的「配置项优美、可展示」——把 agent 组装改为**声明式定义 + 装配器解析**：

1. `AgentDefinition` 值对象：纯声明、不可变、带校验与 `toSnapshot()`；
2. `PromptSection` 注册表：`id@version`，recipe 按序解析；
3. `ToolGroupManifest`：工具组展示层（id/version/label/description/tools）；
4. 实际运行 system prompt 与 legacy 8 块一一对应（§3）；
5. 修复一个真实 bug（§2.1）。

## 2. 现状问题

### 2.1 真 bug：staticSystemCache 短路（必须修复 + 回归）

`LoopContext.renderSystem()`（`core/src/runtime/loop/LoopContext.ts:176-197`）：

```ts
if (section.kind === "static") {
  if (this.staticSystemCache === undefined) {
    this.staticSystemCache = section.render(this);
  }
  parts.push(this.staticSystemCache);   // ← bug
}
```

`staticSystemCache` 是**单个字符串**：首个 static 段渲染后即非 undefined，后续所有 static 段全部 push **第一段的内容**。当前 `systemSections` 顺序为 `[coreRuntimeProtocolSection, novelIdentitySection, novelSystemSection, novelCraftSection, novelExecutionSection, toolGuidanceSection]`，因此 **novel.identity / novel.system / novel.doing-tasks / novel.actions 实际从未进入 system prompt**（协议段被重复 push 5 次）。现有测试只有单 static 段用例，未暴露。

**修复**：`renderStaticBase()` 一次性渲染全部 static 段入 base 缓存；每 provider call 只渲染 dynamic 段追加。新增「多 static 段缓存回归」用例锁死。

### 2.2 结构问题

| 问题 | 现状 | 目标 |
|---|---|---|
| 组装硬编码 | 6 段数组 + 7 组工具工厂内联 | 声明式 `NovelAgentDefinition` + `AgentAssembler` 解析 |
| 工具分发 | 内联 `find` 线性查找 | `MapToolDispatcher` Map 查表 |
| 死代码 | `InMemoryRegistry`/`Registry`/`AgentRegistry` 生产零调用 | 删除 |
| TodoWrite | 工具已实现（`tool/definitions/todo.ts`）未装配 | 本期装配（`runtime.todo` 组） |
| nudge | `compose_mode`/`todo_idle` 已实现未接线 | `nudgeEnablement` 声明 + 目录注册注入 |
| 段缺 id/version/label | 现有段是裸 `{kind, render}` 对象 | 统一 `id@version` + label（对齐 legacy） |

## 3. 与 legacy 8 块对照

legacy `NovelAgentDefinition` 的 recipe 8 段：`novel.identity` → `novel.system` → `novel.doing-tasks` → `novel.actions` → `novel.communication` → `core.runtime.protocol` → `core.environment` → `novel.global_constraints`。

| legacy 段 id | 现状 | 本期动作 |
|---|---|---|
| `novel.identity` | 已就位（`novelIdentitySection`） | 补 id/version/label |
| `novel.system` | 已就位（`novelSystemSection`） | 同上 |
| `novel.doing-tasks` | 已就位（`novelCraftSection`，内容已迁移） | 段 id 对齐为 `novel.doing-tasks` |
| `novel.actions` | 已就位（`novelExecutionSection`） | 段 id 对齐为 `novel.actions` |
| `novel.communication` | **缺** | 新增（legacy 中文文案 14 条迁移） |
| `core.runtime.protocol` | 内容漂移但语义等价 | 保留现文案 |
| `core.environment` | **缺** | 新增 dynamic 段（日期/时区现场计算 + workdir/platform/modelId） |
| `novel.global_constraints` | **缺** | 新增 dynamic 段（NOVEL.md 每调用注入） |
| `tool.guidance`（legacy 中被注释） | 已实现 | **保留启用**——新架构无 promptDetails 注入面，它是工具可见性唯一通道 |

## 4. 配置模型（三层）

### 4.1 AgentDefinition（agent 级值对象）

对齐 legacy `AgentDefinitionOptions` 结构，重写 `core/src/runtime/agent/AgentDefinition.ts`：

```
AgentDefinition {
  agentType: string            // "novel"
  definitionVersion: string    // "1.0.0"（semver）
  label: string
  description: string
  promptRecipe: PromptRecipe   // 有序段计划
  tools: AgentToolPolicy       // groupIds + allow/deny
  delegation: AgentDelegationPolicy   // 本期声明保留、运行时零效果
  communication: AgentCommunicationPolicy  // "standalone"
  runtimePolicyId: string      // "default"
  nudgeEnablement: AgentNudgeEnablement   // enabled: nudgeId[]
}
```

约束：校验 + `Object.freeze` 不可变 + `toSnapshot()` 持久化边界值对象。

### 4.2 PromptSection（判别联合，id@version 注册表）

**判别联合设计（用户确认）**：`kind` 与渲染方法绑定，杜绝「声明 dynamic 却实现 render」的不匹配——编译器层面保证 static 只实现 `render`、dynamic 只实现 `renderDynamic`：

```ts
type PromptSection =
  | { kind: "static"; id; version; label; render(ctx: ReadonlyLoopContext): string }
      // 进 base 缓存：一次渲染，跨 provider call 复用
  | { kind: "dynamic"; id; version; label;
      renderDynamic(input: DynamicPromptSectionInput, ctx: ReadonlyLoopContext): string }
      // 每 provider call 渲染
```

**DynamicPromptSectionInput**（prompt 层不碰 `node:fs`，纯数据注入）：

```ts
interface DynamicPromptSectionInput {
  environment?: { workdir: string; platform: string; modelId?: string };
  novelGlobalConstraints?: { fileName: string; content: string };  // ≤256 KiB
}
```

- `PromptSectionRegistry`：`id@version` 注册，`resolve(sectionId, version?)`，未指定版本取**最新版**（semver 排序，对齐 legacy 语义）；重复注册报错。
- 段 id 对齐 legacy 命名：`novel.doing-tasks`、`novel.actions` 等。

### 4.3 ToolGroupManifest（工具组展示层）

```
ToolGroupManifest { id; version; label; description?; tools: 有序工具名[] }
```

8 组 21 工具（§7）。组声明（manifest）与工具工厂（工厂函数）分离：manifest 是配置展示层，工厂在 `NovelToolGroups.ts` 按组提供。

## 5. novel 实例定义（`NovelAgentDefinition.ts`）

对齐 legacy 风格（legacy 为 `definitionVersion 1.5.0`；新架构重新起版本）：

```ts
export const novelAgentDefinition = new AgentDefinition({
  agentType: "novel",
  definitionVersion: "1.0.0",
  label: "Novel Agent",
  description: "Collaborates with the user to imagine, plan, and create serialized web novels.",
  promptRecipe: new PromptRecipe([/* 9 项，见 §6 */]),
  tools: new AgentToolPolicy({
    groupIds: ["runtime.todo", "runtime.files", "novel.characters", "novel.locations",
               "novel.outline", "novel.paragraph", "novel.publication", "novel.delete"],
  }),
  delegation: new AgentDelegationPolicy({ mode: "subagent",
    allowedAgentTypes: ["Explore", "Compose"] }),   // 声明保留、运行时零效果（subagent 装配不在本期）
  communication: new AgentCommunicationPolicy("standalone"),
  runtimePolicyId: "default",
  nudgeEnablement: { enabled: ["compose_mode", "todo_idle"] },
});
```

## 6. Prompt 组装顺序（recipe 序）

recipe 9 项（static 全前、dynamic 后），最终 system prompt 顺序：

```
novel.identity        (static)   → 身份与创作定位
novel.system          (static)   → 系统与运行规则
novel.doing-tasks     (static)   → 创作任务
novel.actions         (static)   → 谨慎行动
novel.communication   (static)   → 交流风格（legacy 14 条中文文案）
core.runtime.protocol (static)   → 运行时协议
core.environment      (dynamic)  → 环境信息块（每调用）
novel.global_constraints (dynamic) → NOVEL.md 注入（每调用）
tool.guidance         (dynamic)  → 可用工具清单（每调用；只消费 ctx，忽略 input）
（末尾）每工具 # ToolPolicy 追加
```

**AgentAssembler 校验**：按 recipe 序解析；recipe 内 static 必须全在 dynamic 之前（保证 base 缓存 + 动态追加的渲染模型成立）。

## 7. 动态段机制

`LoopContext` 构造时注入 **DynamicInputProvider**（`() => Promise<DynamicPromptSectionInput>`），`toProviderCall` 转为 async：

1. 每 provider call 前 `await dynamicInputProvider()` 取宿主输入；
2. 合并 `environment.modelId = run.sampling.model` 补齐；
3. base（static 渲染缓存）+ 各 dynamic 段 `renderDynamic(input, ctx)`；
4. `systemPrompt` getter 语义 = **最近一次渲染值**。

宿主注入分工（prompt 层不碰 `node:fs`）：

| 输入 | 注入方 |
|---|---|
| workdir / platform | node 层（子进程 entrypoint：`runDesktopRuntimeChildEntrypoint.ts`） |
| NOVEL.md 内容 | node 层 `readNovelGlobalConstraintsSafe`（≤256 KiB，读取失败静默） |
| modelId | `run.sampling.model` 补齐 |

### 各 dynamic 段行为

- **core.environment**：workdir/platform 为空则**整段省略**；否则渲染「时区（`Intl.DateTimeFormat` 现场计算）+ 本地日期 + platform + workdir + modelId」。
- **novel.global_constraints**：**常驻说明恒渲染**（读取语义、内容约束、NOVEL.md 每调用重读即时生效）；文件内容以 `<Novel-Constraints-Content>` 标签包裹；无内容时渲染占位提示（对齐 legacy 文案）。
- **tool.guidance**：恒渲染可用工具清单；无工具时渲染 "No Tools are available…"。

## 8. nudge 语义

- `AgentDefinition.nudgeEnablement.enabled` ∩ **nudge 实现目录** → 注入（新架构守卫简化；legacy 语义为 ∩ 工具组守卫，注明即可）。
- 本期 enabled = `["compose_mode", "todo_idle"]`（legacy 6 项中已实现的 2 项；其余 4 个 compose nudge 本期不做，见 §11 范围外）。
- `todo_idle` 正确性前提：**TodoWrite 本期装配**——`runtime.todo` 组 + `createTodoWriteTool` + `InMemoryConversationTodoStore` 默认实例；entrypoint 传 `todoStore`。
- `compose_mode` 需要 `composeState`：entrypoint 传 `ComposeModeStateProvider`。

## 9. 工具组与 MapToolDispatcher

8 组 21 工具（`NovelToolGroups.ts`：7 组 manifest + 工厂，`runtime.todo` 组本期加入）：

| 组 id | 工具 |
|---|---|
| `runtime.todo` | TodoWrite |
| `runtime.files` | Read, Glob, Write, Edit |
| `novel.characters` | CharacterRead/Write/Edit |
| `novel.locations` | LocationRead/Write/Edit |
| `novel.outline` | OutlineRead/Write/Edit |
| `novel.paragraph` | ParagraphRead/Write/Edit |
| `novel.publication` | PublicationRead/Write/Edit |
| `novel.delete` | NovelDelete |

`MapToolDispatcher`：`Map<name, ToolDef>` 查表 + `resolve/register/list`；`AgentLoop` gateTool 改用 `resolve`；`ToolDispatcher` 接口补 `resolve`。

## 10. buildNovelAgent 新签名

调用点仅 3 处（`NovelAgent.ts` 定义、`runDesktopRuntimeChildEntrypoint.ts`、`novel-agent.test.ts`）：

```ts
buildNovelAgent(definition: AgentDefinition, opts: {
  workspace; provider; handle; conversationId?;
  dynamicInput?: () => Promise<DynamicPromptSectionInput>;
  composeState?: ComposeModeStateProvider;
  todoStore?: ConversationTodoStore;      // 缺省 InMemoryConversationTodoStore
  listeners?; turnMessages?; resumeSeq?;
  requestApproval?; resumePendingDecider?; logger?;
}): AgentLoop
```

装配输出：`AgentCapability`（解析后的 systemSections/toolDefs/nudgePolicies/compactPolicies）+ `MapToolDispatcher` + `AgentLoop`。

## 11. 范围外（本期不做）

- snapshot / hydrator / manifest digest（持久化快照机制；值对象保留 `toSnapshot()` 接口但无消费方）
- subagent 运行时装配（`delegation` 仅声明）
- compose 状态机接线（`compose_mode` nudge 接线依赖 conversation 层既有实现，不含新状态机）
- `PromptCapabilitySnapshot` 注入面
- legacy 其余 4 个 compose nudge（compose_mode_pending/reentry/exit/sparse）

## 12. 实施步骤（每步一个 commit，40 文件 213 用例持续绿）

| 步 | 内容 | 新增测试 |
|---|---|---|
| 0 | **本 PRD 落盘** | — |
| 1 | PromptSection 判别联合 + DynamicPromptSectionInput；LoopContext 缓存修复（renderStaticBase）+ toProviderCall async + dynamicInput 注入 + systemPrompt 语义；现有段补 id/version/label（tool.guidance 改 dynamic 分支）；fixture 同步 | 缓存回归（多 static 段） |
| 2 | AgentDefinition 重写 + PromptRecipe（InlinePromptItem ≤1024、有序唯一）+ PromptSectionRegistry（id@version 最新版解析）+ ToolGroupManifest；删 `registry/` 与 `AgentRegistry`；barrels 更新；smoke 改直构 | prompt-recipe / prompt-section-registry / agent-definition |
| 3 | AgentAssembler（resolveRecipe：按序 + static-before-dynamic 校验；resolveTools：组→工具 + allow/deny；resolveNudges）；NovelAgentDefinition + NovelToolGroups（7 组）；buildNovelAgent 新签名；entrypoint 同步 | agent-assembler |
| 4 | novelCommunicationSection（legacy 14 条文案）+ coreEnvironmentSection（dynamic）+ novelGlobalConstraintsSection（dynamic）；`readNovelGlobalConstraintsSafe`（node 层，≤256 KiB，失败静默）+ entrypoint 组装 dynamicInput；recipe 更新 9 项 | dynamic-sections / novel-global-constraints(node) |
| 5 | nudgeEnablement 接线（compose_mode/todo_idle）；runtime.todo 组 + TodoWrite 装配；nudge 目录注册注入；entrypoint 传 composeState/todoStore | 随既有 nudge 测试 |
| 6 | MapToolDispatcher + AgentLoop gateTool 用 resolve + 接口补 resolve | MapToolDispatcher |
| 7 | 端到端渲染回归：`assemble(novelAgentDefinition)` 完整 prompt 断言块序与 9 段标记（锁死缓存 bug 不回归）+ 全量回归 | 端到端渲染 |
| 8 | `docs/agent-definition-config-prd.md` + architecture.md 更新 | — |

## 13. 验收标准

- **每 commit**：`cd core && pnpm test` 全绿 + typecheck 通过（40 文件 + 新增测试）。
- **最终人工确认**：`node core/scripts/novel-agent-smoke.mjs`（需 token）真实 prompt 含 9 段标记；`conversation-stdio-child.mjs` 验证注入路径。
- **行为等价**：除新增 3 段 + 工具清单外，prompt 语义与 legacy 8 块一一对应；缓存 bug 修复后 identity/system/doing-tasks/actions 真实进入 system prompt。

## 14. 关键文件

| 文件 | 动作 |
|---|---|
| `core/src/runtime/loop/LoopContext.ts` | 缓存修复 + 动态输入通道核心 |
| `core/src/runtime/agent/NovelAgent.ts` | buildNovelAgent 换新签名 |
| `core/src/runtime/agent/AgentDefinition.ts` | 重写值对象 |
| `core/src/runtime/agent/AgentAssembler.ts` | 新装配器 |
| `core/src/runtime/agent/definitions/NovelAgentDefinition.ts` | 新声明实例 |
| `core/src/runtime/agent/definitions/NovelToolGroups.ts` | 新工具组 manifest + 工厂 |
| `core/src/runtime/agent/AgentRegistry.ts`、`core/src/runtime/registry/` | **删除** |
| `core/src/runtime/prompt/PromptSection.ts` | 判别联合 |
| `core/src/runtime/prompt/PromptRecipe.ts`、`PromptSectionRegistry.ts` | 新 |
| `core/src/runtime/prompt/sections/agent.ts`、`sections/novel.ts` | 补 id/version/label + 新增三段 |
| `core/src/runtime/tool/ToolGroupManifest.ts`、`MapToolDispatcher.ts` | 新 |
| `core/src/node/runtime/runDesktopRuntimeChildEntrypoint.ts` | 宿主注入点（dynamicInput/composeState/todoStore） |
| `core/src/node/workspace/readNovelGlobalConstraints.ts` | 新（node 层读 NOVEL.md） |
