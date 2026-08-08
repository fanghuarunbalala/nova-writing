# Novel Compose 模式（设计门）方案

> 状态：已确认（2026-08-07 讨论冻结）
> 对齐对象：Claude Code（CCB）plan 模式——权限模式 + 会话工件 + Enter/ExitPlanMode + 审批门。
> 相关文档：`docs/architecture.md`、`docs/novel-agent-tools.md`、`docs/novel-write-approval-plan.md`。

## 1. 背景与动机

创作流程需要"先设计、后落库"：agent 先产出**内容草稿**（大纲或正文），作者审的是内容本身、可直接编辑，确认后 agent 再落库。

对齐 CCB plan 架构，我们得到**一个通用"设计门"**：

- 大纲草稿与正文草稿走同一个机制，区别只在**提示词内容**与 **subagent 指令**；
- 模式/工具/审批/落库完全一致，不在机制层区分内容类型；
- 取代旧 draft/commit/rebase 机制，并让"逐条 write 前审批"退居为默认模式行为。

## 2. 核心概念与不变量

1. **compose 是临时权限模式**：进入时保存 `preComposeMode`，退出（批准）时恢复 `preComposeMode`；**不存在独立的 executing 权限态**。
2. **bypass 不由 compose 授予**：批准后的落库权限完全由 `preComposeMode` 决定——进入前是 bypass 就回到 bypass，是 default 就回到 default（逐条 ask）。
3. **机制不区分内容类型**（outline / prose）：内容方向由用户指令与提示词决定。
4. **正式稿只由 novel 写工具修改**：compose 期间 canonical 写全部 deny，只有 design md 可写。
5. **设计会话（design session）与权限模式正交**：工件 + 审批 + 落库记录是独立生命周期。

## 3. 权限模式层

### 模式集

`default | acceptEdits | bypassPermissions | dontAsk | auto | compose`

`compose` 为内部临时模式，仅通过 `EnterComposeMode` / `ExitComposeMode` 进入和退出。

### 进入（EnterComposeMode）

```ts
EnterComposeMode { purpose?: string }
```

1. 保存当前权限模式为 `preComposeMode`；
2. 创建会话 design md（`.novel/design/<conversationId>.md`，自由 Markdown）；
3. 注入 session 级权限规则：
   - 12 个 canonical 写工具 → **deny**；
   - `Read` / `Edit` / `Write` → **仅 design 文件路径 allow**；
   - 6 个 novel 读工具 → 保持 allow。

进入**不需要用户批准**（只写 md、不碰正式稿，零风险；ExitComposeMode 才是唯一审批门）。

### 退出（ExitComposeMode）

```ts
ExitComposeMode {}
```

1. 触发审批：复用 `system.tool.approval.requested`（见 §7）；
2. **批准** → 移除 compose 权限规则，模式恢复为 `preComposeMode`；agent 按恢复后的模式用 novel 写工具落库；
3. **拒绝** → 留在 compose，修订 design md 后重新提交。

### 权限实现

通过 `LayeredToolPermissionPolicy` 的 **session 级规则注入/移除**实现，不落静态规则：

- 进入 compose → 注入 deny（canonical 写）+ 路径 allow（design 文件）；
- 批准退出 → 移除 compose 规则，恢复静态 `child_write_edit_ask` 等原行为；
- 归档/放弃 → 清理全部 compose 规则。

### 动态 deny 实现（tool exec 层）

**推荐：状态感知的包装策略，不改 `LayeredToolPermissionPolicy`（不可变）。**

```ts
class ComposeAwareToolPermissionPolicy implements ToolPermissionPolicy {
  constructor(base: ToolPermissionPolicy, state: ComposeModeStateProvider) {}

  evaluate(e: ToolPermissionEvaluation): ToolPermissionDecision {
    const s = this.state.snapshot(); // 会话级 compose 状态，每次调用实时读
    if (s.active) {
      if (CANONICAL_NOVEL_WRITES.has(e.invocation.toolName)) {
        return deny("compose.canonical_write_denied"); // 12 个 canonical 写 → deny
      }
      if (FILE_TOOLS.has(e.invocation.toolName)) { // Read/Glob/Grep/Write/Edit
        const path = readPathArg(e.invocation.arguments); // 权限层可读原始参数
        if (!isWithinDesignScope(e.invocation.toolName, path, s)) {
          return deny("compose.file_outside_design"); // 读∈design 目录；写==当前 design 文件
        }
      }
    }
    return this.base.evaluate(e); // 非 compose → 透传静态规则（ask/allow）
  }
}
```

- 判定链：`ToolDispatcher.#evaluatePermission → ComposeAware.evaluate → deny → #authorize 抛 TOOL_PERMISSION_DENIED`（不进审批、不弹卡、trace 记终态）；
- 组装点：`ChildToolExecutionFactory` 的 `permissionPolicy` 换成 `new ComposeAwareToolPermissionPolicy(layered, composeStateProvider)`；
- 动态性来自 **state**（enter/exit/approve 改状态），不是规则集变动；"恢复 preComposeMode" = `active=false` 透传 base；
- 路径校验放权限层，因为 `CapturedToolInvocation` 带原始 `arguments`（对齐 CCB kvK）；ToolService 内再做一次路径/状态兜底（纵深防御）。

**preComposeMode 现状说明**：harness 目前没有权限模式概念（只有静态 allow/ask/deny 规则），因此 v1 的"恢复 preComposeMode"实际等价于"回到静态规则（default=ask）"；`preComposeMode` 作为扩展点预留——将来实现 bypassPermissions/acceptEdits 权限模式时，进入保存、批准恢复，bypass 与否由该模式决定（与 CCB 对齐）。

## 4. 设计会话层

### 工件

`<workspace>/.novel/design/<conversationId>.md`

- 自由 Markdown，零格式约束（对齐 CCB plan 文件）；
- 内容就是"这轮要写什么"的完整草稿（大纲草稿或正文草稿，由指令决定）；
- 作者可在 GUI 直接编辑该文件。

### 生命周期

```
designing（写 design md）
  → pending（ExitComposeMode 审批）
    → applied（批准后 agent 落库）
    → archived（commit 记录 + md 归档/删除）
```

- **designing**：agent 用 `Glob`/`Grep`/`Read` 调研、`Write`/`Edit` 增量写 md；用户可直接编辑；
- **pending**：审批卡展示 md 渲染内容 + 轻量摘要；
- **applied**：批准后按 `preComposeMode` 权限用 novel 写工具落库（单事务 + baseRevision 乐观锁）；
- **archived**：`novel_operations` 写一条 commit 记录 `{ designId, operationIds[], revisionFrom, revisionTo, approvedAt, conversationId }`，md 归档。

## 5. 工具清单

| 工具 | 签名 | 说明 |
|---|---|---|
| `EnterComposeMode` | `{ purpose?: string }` | 进入 compose；创建 design md；注入权限规则 |
| `ExitComposeMode` | `{}` | 提交审批；批准→恢复 preComposeMode；拒绝→留在 compose |
| `Read`（新增 `runtime.files` 组） | `{ file_path, offset?, limit? }` | 读文件；作用域 = design 目录（只读） |
| `Glob` | `{ pattern }` | 按模式找文件（如 `**/*.md`）；作用域 = design 目录 |
| `Write` | `{ file_path, content }` | 写文件；**仅当前会话 design 文件** |
| `Edit` | `{ file_path, old_string, new_string, replace_all? }` | 增量修改；**仅当前会话 design 文件** |
| 6 个 novel 读工具 | 现状 | 全程可用 |
| 12 个 canonical 写工具 | 现状 | 按权限矩阵 |

错误码新增：`NOVEL_COMPOSE_STATE_INVALID`、`NOVEL_COMPOSE_ALREADY_SUBMITTED`、`NOVEL_DESIGN_FILE_TOO_LARGE`、`NOVEL_DESIGN_FILE_NOT_FOUND`。

### runtime.files 工具细节

对齐 CCB plan 模式工具集（`Read/Glob` 调研 + `Write/Edit` 写 plan 文件）；我们无 Bash/Web 工具，故 v1 文件工具组 = 这 4 个（**Grep 延后**，v1 不接入）。

| 工具 | 参数 | 行为与约束 |
|---|---|---|
| `Read` | `file_path`, `offset?`, `limit?` | cat -n 返回（行号从 1 起）；路径解析后必须落在 `.novel/design/` 目录内；大小上限 512KB，超限报 `NOVEL_DESIGN_FILE_TOO_LARGE`；offset/limit 按行生效 |
| `Glob` | `pattern` | 返回匹配路径（按 mtime 排序）；基准目录 = `.novel/design/`，禁止 `..` 逃逸与绝对路径 |
| `Write` | `file_path`, `content` | 整文件写入；`file_path` 必须**等于当前会话 designFilePath**（不是目录内任意文件） |
| `Edit` | `file_path`, `old_string`, `new_string`, `replace_all?` | 增量编辑；兼容别名 `old_str`/`new_str`；`replace_all` 缺省 false=替换第一个，true=全部；`file_path` 必须等于当前会话 designFilePath |

路径校验规则（ToolService 内统一实现，纵深防御）：

- 解析 `realpath` 后校验（防 `../`、防 symlink 逃逸）；
- 读类（Read/Glob）作用域 = design 目录；写类（Write/Edit）作用域 = 当前会话 design 文件；
- 越界统一报 `NOVEL_DESIGN_FILE_PATH_FORBIDDEN`；
- GUI 直接编辑写回文件（主进程 `NovelDesignFilePort`），agent 经 `Read` 看到最新内容。

## 6. 权限矩阵

| 工具 | idle | compose | 批准后（= preComposeMode） |
|---|---|---|---|
| 6 个 novel 读工具 | ✅ | ✅ | ✅ |
| 12 个 canonical 写工具 | ask | **deny** | 按 preComposeMode（default=ask / bypass=allow / …） |
| `Read` / `Glob`（文件） | ❌（无 design 上下文） | ✅ design 目录内 | ✅（只读，可核对已批内容） |
| `Edit` / `Write`（文件） | ❌ | ✅ 仅当前会话 design 文件 | ❌（内容冻结，落库走 novel 工具） |
| `EnterComposeMode` | ✅ | ❌ | ✅ |
| `ExitComposeMode` | ❌ | ✅ | ❌ |

## 7. 审批复用

- `ExitComposeMode` 构造 `ToolApprovalRequestedPayload`：
  - `approvalRequestId = novel-compose:<conversationId>:<sha256>`；
  - `summary.title = "提交设计草稿"`；
  - `summary.description` = 轻量变更摘要（自动生成，仅辅助，不是确认对象——确认对象是 md 内容本身）。
- 批准/拒绝走现有 `ApprovalDecisionInputEvent` → runtime 解析 compose 审批 → 恢复模式 / 留在 compose。
- GUI 审批卡渲染 md 内容（复用 novel markdown 渲染器），现有审批面板/卡片管线不改。

## 8. 提示层

- 新增**动态提示段** `novel.compose`（`NovelComposeModePromptSection extends DynamicPromptSection`，注册进 `CommonPromptSections`，并加入 novel agent recipe 的静态段之后）；
- 遵循 main prompt 架构：dynamic 段**编译期不产生内容**（不进 manifest 编译产物），运行时由 `RuntimeSystemPromptBuilder` 每调用渲染——`renderDynamic(input)` 按 `input.compose` 状态决定内容，**空串自动跳过**（非 compose 零污染）；
- compose 快照由 `DefaultRuntimeRunPreparationSourceFactory` 在每调用 `input` 中注入（与 `core.environment` 同机制），composeState 由 `DesktopRuntimeChildEntrypoint` 创建并共享给 run preparation source 与 composition factory；
- 文案要点（仅 designing / pending 有内容）：
  - designing："当前处于设计模式：只读正式稿，唯一可写是设计草稿文件；逐步写出内容；结束时用 ExitComposeMode 提交，不要用文本询问审批。"
  - pending："设计草稿已提交审批，等待作者确认。"
- 大纲/正文的产出方向由用户指令与对话上下文决定，**不在提示段硬编码类型**。
- 大纲/正文的产出方向由用户指令与对话上下文决定，**不在提示段硬编码类型**。

## 9. Subagent（预留）

| 类型 | 对齐 CCB | model | 工具 | 产出 |
|---|---|---|---|---|
| `Explore` | Explore | 便宜档 | 仅 6 个 novel 读工具 + TodoWrite；无写/无文件/不能派生 | 设定、时间线、伏笔、矛盾点结论（返回文本） |
| `Compose` | Plan | inherit | 同上只读 | 大纲或正文设计文本（按指令区分；返回文本，不写 design md） |

- 两者独立会话、不共享 compose 状态；
- v1 暂不接线（novel agent `delegation: disabled`），只预留 manifest 与工具策略设计；
- Explore/Compose 的内容区分只靠**子代理提示词**，不建两套工具。

## 10. GUI

- **设计卡**（ChatSurface 新投影器）：渲染 design md（novel markdown 渲染器 + 引用），带"编辑"切换 → 直接改正文 → 保存（主进程写回工件文件，不经工具）；
- **状态徽标**（TopBar）：设计中 / 待审批（批准后恢复模式，无"执行中"态）；
- **审批面板复用**：InspectorHost 审批 tab 展示 ExitComposeMode 卡片（正文 + 摘要 + 批准/拒绝）；
- **事件流**：`novel.compose.begin/submitted/approved/rejected/applied/discarded` 终态进 `RuntimeEventFlow`。

## 11. 一致性（大纲 ↔ 正文）——暂缓

2026-08-07 决策：大纲与正文的一致性联动（偏差声明、受影响章节清单）**暂不实现**，后续再议。
提示词中不包含一致性义务文案。

## 12. 分步实施

| 步 | 内容 | 验证 |
|---|---|---|
| ~~M0~~ ✅ | 权限模式 compose + `EnterComposeMode/ExitComposeMode` + `preComposeMode` 保存/恢复 + `novel.compose.*` 事件 | 已实现：`ComposeModeStateProvider` + 6 个 `novel.compose.*` 事件 + `ComposeAwareToolPermissionPolicy`（canonical 写 deny/文件工具作用域）+ `ComposeApprovalLifecycleSink`（submitted/approved/rejected 挂钩）；冒烟覆盖状态迁移、权限断言、审批全链路 |
| ~~M1~~ ✅ | 新增 `runtime.files`（Read/Glob/Write/Edit：读∈design 目录、写==当前 design 文件；**Grep 延后**）+ design md 工件 | 已实现：TypeBox schemas + FileToolService（picomatch glob / realpath 沙箱 / 原子写）+ 工具定义与 registry + 接线（child registry、manifest composition、agent policy、`child_files_read_allow`）+ service/registry/wiring 冒烟；全量 smoke 225 全绿 |
| ~~M2~~ ✅ | `ExitComposeMode` 接入 `system.tool.approval.requested/resolved`；批准→恢复模式；拒绝→留在 compose | 已实现：Exit 走 tool.approval（摘要"提交设计草稿"）、批准→`applied`、拒绝→回 `designing`；`novel-compose-tools-smoke` 覆盖 |
| ~~M3~~ ✅ | 落库收口：审计 commit 记录 + md 归档（依赖 canonical 基座） | 已实现：`novel_compose_commits` 表（迁移 v12）+ `SqliteNovelComposeCommitStore` + `ComposeToolService.exit` 归档与摘要；`novel-compose-commit-smoke` 覆盖；全量 smoke 228 全绿 |
| ~~M4~~ ✅ | 提示词 `novel.compose` **动态段**（DynamicPromptSection）+ recipe 项 + 每调用 input 注入 compose 快照 | 已实现：`NovelComposeModePromptSection`（renderDynamic 按 compose 状态渲染、空串跳过）+ recipe 加入 `novel.compose` + `DefaultRuntimeRunPreparationSourceFactory` 注入 compose 快照；`prompt-compose-mode-smoke` 覆盖段级与 builder 级断言 |
| ~~M5~~ ✅ | GUI：设计卡（渲染/编辑）、徽标、审批面板联调 | 已实现：Electron 设计文件端口（IPC/preload/resolver/port）+ `DesignCard`（读/渲染/编辑/保存/降级）+ timeline 设计卡 + ChatSurface 状态徽标 + ExitComposeMode 审批卡内嵌草稿；ui 207 tests 全过；剩余手动 Electron 验证 |
| M6 ⏸ 延后 | 删除旧 draft/commit/rebase/approval/conflict 生产模块（`core/src/novel/{draft,commit,conflict,approval}` + sqlite store/digester + 旧事件类型/schema + 相关 smoke） | 属 P4 级重构（生产装配 + 查询 API + GUI 历史提交迁移），作为独立主线推进；当前旧模块保持休眠（S9a 已移除 agent 暴露面） |

## 13. 与既有代码的关系

- **新增**：`runtime.files` 工具组（M1 前置）；compose 权限规则与工具（`novel.compose` 组）；`runtime.composeMode` 提示段；
- **复用**：`system.tool.approval.*` 审批管线、`ApprovalDecisionInputEvent`、审批卡/面板、`LayeredToolPermissionPolicy` session 规则、novel markdown 渲染器、消息层 reminder 注入（checkpoint/nudge 机制）；
- **基座**：落库依赖 `SqliteNovelCanonicalWriter`（单事务 + baseRevision 乐观锁；若未合入，M3 前先补 P1）；
- **删除（M6）**：旧 `core/src/novel/draft`、`core/src/novel/commit`、`core/src/novel/approval`（changeSet 审批）等被取代机制。

## 14. 决策记录（2026-08-07）

1. 模式名 **compose**；工具 `EnterComposeMode` / `ExitComposeMode`；
2. 批准后**恢复 preComposeMode**，无 executing 态；bypass 与否取决于进入前的模式；
3. 模式层**不区分** outline/prose；区分只在提示词与 subagent 指令；
4. **一致性（大纲↔正文联动）暂缓**；
5. `ExitComposeMode` **不预留** `allowedNovelTools` 参数位（v1 完全恢复原模式，后置再议）；
6. `runtime.files` v1 = `Read/Glob/Write/Edit`（**Grep 延后**）；schema 与行为对齐 CCB（参考 `docs/ccb-runtime-files-reference.md`，代码自研）；读∈design 目录、写==当前会话 design 文件；非 compose 时文件工具不可用；`EnterComposeMode` 不需用户批准（直接进入）；
7. `AskUserQuestion` 后续讨论；
8. subagent 预留 `Explore` / `Compose` 两种只读类型，v1 不接线。
9. **M6/S9b 延后**（2026-08-08）：删除旧 draft/commit/rebase/approval/conflict 生产模块属 novel-write-approval P4 级重构——`NodeNovelApplication`/`EntityApplication`/`WorkspaceHost` 生产装配、`NovelQueryApiRouter` 的 draft 查询、GUI"历史提交"（需先切到 `novel_compose_commits`）。执行计划：S9b-0 GUI 历史迁移 → S9b-1 生产装配重接 → S9b-2 删除 domain/store/事件/smoke（表结构保留）→ S9b-3 文档与全量回归。旧模块当前休眠、S9a 已移除 agent 暴露。
