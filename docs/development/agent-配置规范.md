# Agent 配置规范（声明式装配）

1. **组装必须走声明式配置**：AgentCapability 禁止硬编码组装。新 agent =
   `runtime/agent/definitions/` 下的 `AgentDefinition` 声明实例（promptRecipe /
   tools / delegation / communication / runtimePolicyId / nudgeEnablement），
   经 `AgentAssembler` 解析；工具组声明在 `runtime/tool/groups/`。

2. **PromptSection 判别联合**：kind 与渲染方法绑定——
   - static：只实现 `render(ctx)`，一次渲染进 base 缓存（内容恒定）；
   - dynamic：只实现 `renderDynamic(input, ctx)`，每 provider call 渲染；
     输入缺失/无内容时返回空串（整段省略）；
   - 每段必须有 `id@version` + `label`；段 id 按域命名（`novel.*` / `core.*` /
     `tool.guidance`）；recipe 内 static 全在 dynamic 之前（Assembler 校验）。

3. **动态段输入由 LoopContext 组装**：`workdir` 取 `ctx.workspace`、`modelId`
   取 `run.sampling.model`，不绕注入；宿主只注入 LoopContext 拿不到的两项——
   `platform`（进程常量，构造注入一次）与 NOVEL.md 内容（node 层每调用
   fs 读取，失败返回 undefined → 动态段渲染占位）。prompt 段保持纯函数，
   不碰 `node:fs`。

4. **工具组两层分离**：`tool/definitions/` = 工具本体工厂；`tool/groups/` =
   `ToolGroupManifest` 展示层（id/version/label/tools 有序唯一）+ 组工厂解析
   （按 manifest.tools 名称 → ToolDef，缺工具报错）。新工具先入 definitions
   工厂，再入 groups 清单，最后进 `AgentDefinition.tools.groupIds`。
   运行时依赖经 `NovelToolGroupResolverOptions` 闭包注入（如 `compose` 服务、
   `ask` 提问通道——AskUserQuestion 挂起等待作者作答，由 buildNovelAgent 从
   `requestAsk` 传入；**仅主代理启用 `runtime.ask`**，compose 子代理刻意不启用
   （子代理专注草稿，提问经主代理）。

5. **nudge 生效集**：`definition.nudgeEnablement.enabled` ∩ 实现目录
   （buildNovelAgent 组装 catalog，按 enabled 声明序实例化）；
   未列入 enabled 的 nudge 不注入。

6. **值对象规范**（AgentDefinition / PromptRecipe / ToolGroupManifest /
   注册表）：构造校验 + `Object.freeze` 不可变 + `toSnapshot()` 持久化边界；
   快照无消费方时不伪造消费方。
