# Novel 前端架构设计

- 文档状态：进行中（第 1、2 部分已确认；第 3 部分待补）
- 创建日期：2026-08-05
- 设计依据：`vendor/index.html` 设计原型 + 现有 `@novel/ui` 与 `@novel/gui` 代码
- 范围：`@novel/ui`（共享 React 层）+ `@novel/gui/src/renderer`（桌面组合层）；`@novel/core` 前端契约保持稳定

---

## 0. 决策摘要

| 维度 | 决策 |
|---|---|
| 演进策略 | 全新设计：以原型为设计目标，现有 `@novel/ui` 作为参考而非约束 |
| 覆盖范围 | `@novel/ui` + `@novel/gui/src/renderer`；`@novel/core` 前端契约（NovelApiClient / Conversation / Projection / WorkspaceController）保持稳定 |
| V1 表面 | 顶栏 + 侧栏 + 主区（对话/内容/计划 三视图）+ 审批 inspector + overlays（设置/Workspace 选择/Toast）全部覆盖 |
| 模块组织 | Approach B：域优先垂直切片（domains/）+ shell 组合层（shell/）+ 共享基础设施（shared/） |
| 状态管理 | 外部 class store + `useSyncExternalStore` + immutable snapshot |
| 样式 | CSS Modules + design tokens（CSS 变量，OKLCH） |
| 基础组件 | 自建 + 少量 headless（Radix Primitives 用于 Dialog/Dropdown/Tabs/Tooltip） |
| 视图路由 | 自定义状态机（`MainViewRouter` + `InspectorRouter`），不引入 React Router |
| 数据获取 | 自定义 hooks + `useSyncExternalStore`（数据来自 core 投影/IPC，非 HTTP） |

---

## 1. 架构总览与共享层（已确认）

### 1.1 分层模型与依赖规则

```
┌─────────────────────────────────────────────────────────────┐
│ @novel/core  (stable, headless)                             │
│   NovelApiClient · Conversation · Projection · Transport    │
└─────────────────────────────────────────────────────────────┘
                            ↑ consumed via hooks
┌─────────────────────────────────────────────────────────────┐
│ @novel/ui                                                   │
│   domains/    垂直切片：业务域的全部 components+hooks+store  │
│   shell/      组合层：把域拼成 topbar/sidebar/main/inspector │
│   shared/     基础设施：primitives/theme/platform/state/routing │
│   extensions/ 扩展契约（已存在）                             │
│   app/        NovelApp 入口                                 │
└─────────────────────────────────────────────────────────────┘
                            ↑ consumed via NovelApp entrypoint
┌─────────────────────────────────────────────────────────────┐
│ @novel/gui/src/renderer                                     │
│   DesktopNovelApp = NovelApp + ElectronPlatform + Transport │
│   + DesktopUiExtensions（桌面专属 titlebar/commands/panels）  │
└─────────────────────────────────────────────────────────────┘
```

**依赖规则（强制）**：

- `domains/*` 可 import `shared/*` 与 `@novel/core`，**禁止** import `shell/*` 或其他域
- `shell/*` 可 import `domains/*` 与 `shared/*`，**禁止**直接 import `@novel/core/node` 或平台 API
- `shared/*` 只能 import `@novel/core` 与 React，**禁止** import 域或 shell
- `shared/platform/` 定义 port 接口，实现在 `gui/src/renderer` 内
- 任何层都不允许向上 import

### 1.2 模块结构（@novel/ui/src/）

```
ui/src/
├─ app/
│  ├─ NovelApp.tsx               # 公共入口；组装 Provider 与 ApplicationShell
│  ├─ NovelAppProvider.tsx       # api/platform/extensions/logger context
│  └─ NovelAppContext.ts
├─ domains/
│  ├─ conversation/              # 对话域：timeline / composer / cards / projection
│  ├─ novel/                     # 小说域：overview/outline/manuscript/character/location
│  ├─ approval/                  # 审批域：queue / diff / actions / store
│  ├─ workspace/                 # 工作区域：controller / footing / selection
│  └─ schedule/                  # 计划域：stats / todos / progress / aggregation
├─ shell/
│  ├─ ApplicationShell.tsx       # 顶层壳
│  ├─ topbar/                    # 顶栏
│  ├─ sidebar/                   # 左侧栏（sections 组合多个域）
│  ├─ main/                      # 主区（路由 chat/content/schedule）
│  ├─ inspector/                 # 右侧 inspector（路由 approval/entity/conversation）
│  └─ overlays/                  # 设置/Workspace选择/Toast
├─ shared/
│  ├─ theme/                     # tokens.css + global.css + ThemeProvider
│  ├─ primitives/                # Button/Dialog/Tabs/Tooltip/...基础组件
│  ├─ platform/                  # FrontendPlatform port + 各 port 接口
│  ├─ state/                     # ExternalStore 基类 + useExternalStore
│  └─ routing/                   # MainViewRouter + InspectorRouter
├─ extensions/                   # 已存在的扩展契约
├─ client/                       # NovelApiContext + useNovelApi
└─ index.ts                      # 公共 re-export
```

### 1.3 共享基础设施（shared/）

#### 1.3.1 `shared/theme/` -- 视觉令牌系统

| 文件 | 作用 |
|---|---|
| `tokens.css` | 设计令牌（CSS 变量）：颜色（OKLCH）、字体、间距、圆角、阴影、动画时长。从原型 `:root` 抽出，命名规范 `--color-fg`、`--space-2`、`--radius-md` 等 |
| `global.css` | 全局重置、`body` 背景、字体加载、`prefers-reduced-motion` 适配 |
| `animations.css` | 通用动画关键帧（`grad-flow`、`view-in`、`conv-spin`），供各域通过 class 引用 |
| `ThemeProvider.tsx` | 设置 `<html data-theme="light">` 根属性；提供 `useTheme()` 读取当前主题（为未来 dark mode 预留） |

**职责边界**：theme 只产出令牌与全局样式；组件视觉细节由各域的 `.module.css` 引用令牌实现。

#### 1.3.2 `shared/primitives/` -- 基础组件

| 组件 | 作用 | 备注 |
|---|---|---|
| `Button.tsx` | 主/次/幽灵/危险四种 variant，三种 size | 替代原型 `.btn` 系列 |
| `IconButton.tsx` | 仅图标的方形按钮，含 aria-label | 替代 `.icon-btn` |
| `Dialog.tsx` | 模态对话框 | 基于 Radix Dialog，含焦点陷阱与 ESC 关闭 |
| `Dropdown.tsx` | 下拉菜单 | 基于 Radix Dropdown，用于对话项的"⋯"菜单 |
| `Tabs.tsx` | 标签页 | 基于 Radix Tabs，用于内容视图 4-tab 与 inspector tabs |
| `Tooltip.tsx` | 悬浮提示 | 基于 Radix Tooltip |
| `Separator.tsx` | 分隔线 | 替代原型 `border-bottom` 散写 |
| `DragHandle.tsx` | 拖拽分隔条 | 用于 inspector 宽度调整，触发 `onResize(px)` |
| `Spinner.tsx` | 加载指示器 | 替代 `.st-spin` |
| `Badge.tsx` | 数字/状态徽章 | 替代 `.count-pill`、`.todo-count` |
| `Pill.tsx` | 状态药丸 | pending/approved/changed/info 四色，替代 `.pill` |
| `Avatar.tsx` | 头像 | user/agent 两种 variant，替代 `.avatar` |
| `Kbd.tsx` | 键盘快捷键展示 | 替代原型 `<kbd>` |
| `Text.tsx` | 文本基础元素，含 size/weight/color variant | 统一排版 |
| `Icon.tsx` | 图标封装 | 基于 `lucide-react`，统一 size/strokeWidth |

**职责**：仅提供视觉与可访问性，不持有业务状态；props 透传原生属性。

#### 1.3.3 `shared/platform/` -- 平台端口

复用已存在的 `FrontendPlatform` 与各 port（FileSelection/Clipboard/Notification/WorkspacePicker/WorkspaceSession）。新增：

| 文件 | 作用 |
|---|---|
| `FrontendPlatformContext.tsx` | 已存在，提供 `useFrontendPlatform()` |
| `DesktopPlatformApi.ts` | 桌面专属能力接口（window/updater/systemTray/nativeFiles），由 gui renderer 注入到 extensions，不进入 shared |

#### 1.3.4 `shared/state/` -- 状态基础设施

| 文件 | 作用 |
|---|---|
| `ExternalStore.ts` | 抽象基类：`subscribe(listener)`、`getSnapshot()`、`notify()`，自带 listener 集合与不可变快照约定 |
| `useExternalStore.ts` | `useSyncExternalStore` 的封装，提供类型推断与默认相等比较 |
| `ImmutableSnapshot.ts` | `Object.freeze` 辅助，深度冻结快照防止误改 |
| `TaskSerializer.ts` | 异步任务串行器（已用于 WorkspaceController），保证 UI 命令不会并发修改同一资源 |

**约定**：每个域的 store extends `ExternalStore`；快照必须 `ImmutableSnapshot.freeze()`；所有 mutation 内部 `notify()`。

#### 1.3.5 `shared/routing/` -- 视图路由

| 文件 | 作用 |
|---|---|
| `MainViewRouter.ts` | 主区视图状态机：state ∈ `{chat, content, schedule}`；提供 `transition(next)`、`back()`、`forward()`；可订阅 |
| `MainViewHistory.ts` | 简单的双栈历史记录（back/forward），不使用 URL |
| `InspectorRouter.ts` | Inspector 路由：state ∈ `{closed, approval, entity, conversation, outlineUnit}` + target id；可订阅 |
| `useMainView.ts` | hook，订阅 MainViewRouter |
| `useInspectorRoute.ts` | hook，订阅 InspectorRouter |

**为什么不用 React Router**：桌面应用无 URL 概念；状态机足够简单；避免引入 URL 同步与 history API 兼容性。

### 1.4 跨域数据流

```
                  ┌──────────────────────────────────────┐
                  │  WorkspaceController (workspace 域)  │
                  │   activeWorkspace$  ─────────────────┼──-> 触发各域 load
                  └──────────────────────────────────────┘
                                       │
        ┌──────────────────┬───────────┼───────────────┬──────────────────┐
        ▼                  ▼           ▼               ▼                  ▼
  ┌──────────┐      ┌──────────┐  ┌──────────┐   ┌──────────┐      ┌──────────┐
  │conversation│    │  novel   │  │ approval │   │ schedule │      │ (其他)   │
  │ catalog$  │    │overview$ │  │ queue$   │   │ stats$   │      │          │
  │ projection$│   │ outline$ │  │ changeSet$│   │ todos$   │      │          │
  │           │    │manuscript$│ │          │   │ progress$│      │          │
  │           │    │ chars$   │  │          │   │          │      │          │
  │           │    │ locs$    │  │          │   │          │      │          │
  └─────┬────┘    └────┬─────┘  └────┬─────┘   └────┬─────┘      └──────────┘
        │              │             │              │
        │  shell/ 通过 hook 订阅各域 store，组合渲染
        ▼              ▼             ▼              ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  shell/sidebar/  shell/main/  shell/inspector/  shell/topbar│
  └─────────────────────────────────────────────────────────────┘
```

**关键流**：

1. **Workspace 激活流**：用户选 Workspace -> `WorkspaceController.open()` -> 各域 store 的 `loadWorkspace(workspaceId)` 被触发（由 shell 顶层 effect 协调，不直接耦合）-> 各域独立从 `@novel/core` API 加载数据 -> 各自 notify。

2. **对话消息 -> 审批联动**：conversation 域投影出 `ProposalCard`，卡片含 `changeSetId` -> 用户点击 -> shell 调 `InspectorRouter.transition('approval', changeSetId)` -> approval 域加载该变更集详情 -> inspector 渲染 diff。

3. **审批通过 -> 小说域刷新**：用户在 inspector 批准变更集 -> approval 域调用 core API 提交 -> approval store 更新队列 -> novel 域 store 监听到 core 投影 revision 变化，自动 reload 受影响实体 -> schedule 域重新聚合。

4. **内容视图选中 -> inspector 详情**：用户在 `ContentSurface` 点大纲节点 -> novel 域 `StoryOutlineTreeStore.select(unitId)` -> shell 调 `InspectorRouter.transition('outlineUnit', unitId)` -> inspector 渲染 `OutlineUnitInspector`。

5. **跨域聚合（schedule）**：schedule 域 store 订阅 novel overview store + approval queue store + conversation projection，聚合产出 `stats`、`todos`、`progress` 快照。schedule 自己不发请求，只做派生。

**协调原则**：域之间不直接 import 对方，只通过：
- 共享 core API（数据真实来源）
- shell 层的 effect（副作用协调）
- 派生 store（如 schedule 订阅其他域 store 的快照）

---

## 2. 业务域详细设计（已确认）

每个域遵循同一结构：**职责** -> **组件**（含作用说明） -> **hooks** -> **store** -> **projection** -> **跨域联动**。

### 2.1 `domains/conversation/` -- 对话域

**职责**：管理对话列表、对话内消息时间线、流式草稿、结构化卡片（think/proposal/diff/quote/table/plan）、composer 输入。是用户与 Novel Writer 交互的主入口。

#### 组件

| 组件 | 作用 |
|---|---|
| `ConversationTimeline` | 时间线滚动容器；按 Journal Sequence 渲染消息；管理自动滚动到底部、虚拟化（消息 >200 条时） |
| `UserMessage` | 用户消息气泡：头像"我" + who + 时间 + 文本；文本中 `<character id="x">` 等内联标记渲染为可点击 chip |
| `AssistantMessage` | Agent 消息气泡：头像 NW + who + 时间 + approval-state pill（生成中/已完成/已提交 rXXX）+ think + text + cards |
| `ThinkBlock` | 可折叠的思考块；展开时显示 `ThinkLine[]`；data-expanded 状态由用户点击切换；流式时自动展开 |
| `ThinkLine` | 单条思考行：tl-mark + 文本 + tl-tag（伏笔/视角/地点/变更/语言/节奏/一致性等） |
| `ProposalBlock` | 提案块：proposal-head（ptag 计划/提议/已应用 + h4 + meta）+ op 列表 + proposal-foot（操作按钮） |
| `ProposalOp` | 单条操作行：op-mark（+ / ~ / − / ->）+ 描述 + op-kind tag（manuscript/outline/character/location/todo/plan/scope） |
| `MessageReference` | 消息文本中的内联实体引用；点击触发 `InspectorRouter.transition('entity', id)` |
| `ConversationComposer` | 输入区：textarea + 模式切换 + 发送按钮 + 引用 chips（@character/@location/@outline） |
| `ComposerModeBar` | 模式切换条：对话/规划/重写等模式；模式决定 agent 的 system prompt 与 tool 集 |
| `GenStatus` | 生成状态指示：流式时显示 spinner + 当前阶段文案；失败时显示失败原因与重试 |
| `ChatEmptyState` | 空对话占位：提示语 + 推荐起手式 |
| `ConversationList` | 侧栏对话列表；每项含 status 指示器（generating/failed 时显示 conv-status） |
| `ConversationListItem` | 单条对话项：title + sub（agent label / 最后活动时间）+ pin 标记 + ⋯ 菜单触发 |
| `ConversationItemMenu` | 对话项右键菜单：重命名 / 置顶 / 删除；基于 `Dropdown` primitive |
| `NewConversationButton` | "新建对话"主按钮；点击触发 `useConversationCatalog().create()` |

#### hooks

- `useConversationCatalog()` -- 对话列表 + create/select/delete 操作；订阅 `ConversationCatalogStore`
- `useConversationProjection(conversationId)` -- 已存在；返回 timeline items + controller state + enqueue/resume
- `useConversationRuntimeStatus(conversationId)` -- runtime 连接状态、当前 run/turn
- `useComposerDraft(conversationId)` -- 草稿文本、引用列表、模式；持久化到 `ComposerDraftStore`

#### store

- `ConversationCatalogStore` extends `ExternalStore` -- 对话列表快照、active id、loading/error phase；通过 `api.conversations.list/open/create` 加载
- `ComposerDraftStore` -- 每对话一份草稿；含文本、引用、模式；进程内持久化（已存在）
- `ConversationProjectionBinding` -- 已存在；hook 内部使用，不暴露

#### projection（view-neutral）

- `ConversationTimelineItem` -- 时间线条目类型：`{ kind: 'user'|'assistant'|'system', sequence, ... }`
- `AssistantDraftProjection` -- 流式草稿：ordered deltas + 终态；从 core 投影派生
- `ConversationCardDescriptor` -- 已存在；卡片类型 union（text/proposal/diff/table/quote/plan）

#### cards/（卡片渲染器注册）

每个卡片类型一个 renderer，注册到 `ConversationCardRendererRegistry`：

| Renderer | 渲染内容 |
|---|---|
| `TextCardRenderer` | 纯文本段落（含富文本标记：`<b>`/`<hl>`/`<code>`/`<table>`/`<quote>`/`<character>`/`<location>`/`<outline>`） |
| `ProposalCardRenderer` | ProposalBlock |
| `DiffCardRenderer` | 内嵌 diff 卡片（消息内引用某个变更集） |
| `TableCardRenderer` | 表格（含 row/cell/hl 标记） |
| `QuoteCardRenderer` | 引用块 |
| `PlanCardRenderer` | 规划结果卡片（todo/plan/scope 三类 op，无变更） |

#### 跨域联动

- 点击 `MessageReference` -> `InspectorRouter.transition('entity', id)` -> 通知 novel 域加载详情
- 点击 `ProposalBlock` 内"前往审批 Diff" -> `InspectorRouter.transition('approval', csId)` -> 通知 approval 域加载
- proposal 卡片显示的 op 描述需要 novel 域实体 label -> 通过 `novel.overview` store 查找

### 2.2 `domains/novel/` -- 小说域

**职责**：管理小说的 5 类数据（overview/outline/manuscript/character/location）的查询、缓存、本地视图状态（展开/选中）。提供 4-tab 内容视图所需的全部数据与组件。

#### 2.2.1 overview/

| 文件 | 作用 |
|---|---|
| `NovelOverviewStore.ts` | workspace 级概览：counts（storyUnit/character/location/chapter/manuscriptBlock）+ phase（loading/ready/error）+ novelId/label |
| `useNovelWorkspaceOverview(workspaceId)` | 已存在；订阅 store，触发 load |

#### 2.2.2 outline/

**组件**：

| 组件 | 作用 |
|---|---|
| `StoryOutlineTree` | 大纲树容器；从 `StoryOutlineTreeStore` 读取展开/选中态，渲染 `StoryOutlineTreeRow[]` |
| `StoryOutlineTreeRow` | 单行：depth 缩进 + caret（leaf/expanded/collapsed）+ name + u-scope（ARC/SCENE）+ 双轴 status + u-prog |
| `StoryOutlineTreeStatus` | 双轴状态指示：plan-m（pm-1/2/3 三段进度）+ real-node（pending/in-progress/blocked/abandoned）；hover 显示 title 文案 |
| `StoryOutlineTreeLegend` | 树顶部 legend：解释 plan-m 与 real-node 含义 |
| `OutlineBlockNote` | 阻塞/搁置说明条："阻塞原因：decision-required · 依赖「潮汐时刻表」" |

**hooks**：`useStoryOutlineTree(workspaceId)` -- 已存在

**store**：`StoryOutlineTreeStore` -- 树数据 + 展开状态 + 选中 unitId；订阅 core `api.novel.outline`

**projection**：`StoryOutlineTreeProjection` -- 从扁平 StoryUnit[] 构建有序树，派生 progress（如 3/4）

#### 2.2.3 manuscript/

**组件**：

| 组件 | 作用 |
|---|---|
| `ManuscriptChapterList` | 章节列表容器；渲染 `ManuscriptChapterCard[]`，支持草稿章节（待审批）单独样式 |
| `ManuscriptChapterCard` | 章节卡片：header（章节标题 + rev 标签 + 草稿 tag）+ `ManuscriptBlock[]` |
| `ManuscriptBlock` | 单块：b-head（b-id 如 §3-01-04 + b-dg digest 短码 + b-draft 草稿标）+ 段落文本 |
| `ManuscriptDraftTag` | "草稿"标记，仅在 draft 块显示；点击跳转到审批 inspector |

**hooks**：`useManuscriptStructure(workspaceId)`、`useManuscriptBlock(workspaceId, blockId)`

**store**：`ManuscriptStructureStore` -- Publication/Chapter/Block 层级结构；block 文本按需加载（点击展开才请求）

#### 2.2.4 character/

**组件**：

| 组件 | 作用 |
|---|---|
| `CharacterGrid` | 网格容器；响应式列数（窄 1 列 / 宽 2-3 列） |
| `CharacterCard` | 单卡片：e-av（首字头像）+ e-name + e-role + e-note + e-chips（关联故事单元） |
| `CharacterDetailPanel` | inspector 内详情：完整 profile + version + 关联单元列表 + "在内容中定位"按钮 |

**hooks**：`useCharacterList(workspaceId)`、`useCharacterDetail(workspaceId, characterId)`

**store**：`CharacterStore` -- 列表 + 详情缓存（LRU，最多 20 个详情）

#### 2.2.5 location/

| 组件 | 作用 |
|---|---|
| `LocationGrid` | 网格容器 |
| `LocationCard` | 单卡片：e-av + e-name + e-role + loc-state（已建档/草稿新增 badge）+ e-note + e-chips |
| `LocationDetailPanel` | inspector 详情：完整 profile + 关联单元 + "在内容中定位" |

**hooks**：`useLocationList(workspaceId)`、`useLocationDetail(workspaceId, locationId)`

**store**：`LocationStore` -- 列表 + 详情缓存

#### 跨域联动

- outline 选中 unit -> `InspectorRouter.transition('outlineUnit', unitId)` -> inspector 渲染 `OutlineUnitInspector`
- character/location 选中 -> `InspectorRouter.transition('entity', {kind, id})` -> inspector 渲染 `EntityInspector`
- 审批通过后 -> approval store 通知 novel store `invalidate(scope)` -> 重新加载受影响实体
- schedule 域订阅 `NovelOverviewStore` 派生 stats

### 2.3 `domains/approval/` -- 审批域

**职责**：管理变更集（ChangeSet, CS-XXXX）队列、单个变更集 diff 详情、审批动作（批准/拒绝/请求修改/备注）。串联 conversation proposal 卡片与 inspector diff review。

#### 组件

| 组件 | 作用 |
|---|---|
| `ApprovalQueueList` | 侧栏审批队列；渲染 `ApprovalQueueItem[]`；空态显示"暂无待审批" |
| `ApprovalQueueItem` | 队列项：appr-id（CS-XXXX）+ title + meta + pill（pending/approved/changed/info）；active 态高亮 |
| `ApprovalInspector` | inspector 主容器；含 `ApprovalTabs` + 内容区 |
| `ApprovalTabs` | 审批流 / 详情 两个 tab；基于 `Tabs` primitive |
| `ApprovalChangeSetList` | 审批流 tab：列出当前 workspace 全部 CS；点击切换 active CS |
| `ApprovalChangeSetPane` | 单个 CS 详情面板：identity + diff sections + actions + note |
| `ApprovalIdentity` | identity 卡片：CS 编号 + scope（manuscript/outline/character/location）+ rXXX -> rYYY + 状态 pill |
| `ApprovalDiffLegend` | 图例：+ 新增 / − 删除 / -> 移动 / ~ 修改 |
| `ApprovalDiffSection` | diff 分组（如"大纲"、"正文"、"角色"）；含 legend + diff-box |
| `ApprovalDiffRow` | 单行 diff：drow add/mod/del/move；含 d-main + old-new（修改时显示 chip-old -> chip-new） |
| `ApprovalDetailFoot` | 详情底部：actions + request-box + note-box |
| `ApprovalActions` | 批准 / 拒绝 / 请求修改 三个按钮；pending 态显示 spinner |
| `ApprovalRequestBox` | "请求修改"展开后的输入区 + 提交/取消 |
| `ApprovalNoteEditor` | 备注 editor；可编辑、可查看历史备注 |
| `ApprovalResolvedBanner` | "已批准并提交 · NovelRevision r041 · 输出事件已入账" 横幅 |

#### hooks

- `useApprovalQueue(workspaceId)` -- 订阅 `ApprovalQueueStore`
- `useApprovalChangeSet(workspaceId, csId)` -- 订阅 `ApprovalChangeSetStore`，懒加载详情
- `useApprovalActions(workspaceId, csId)` -- approve/reject/requestModification；返回 action phase

#### store

- `ApprovalQueueStore` extends `ExternalStore` -- CS 队列快照（id/title/scope/status/meta）；通过 core `api.approval.list` 加载
- `ApprovalChangeSetStore` -- 单 CS 详情缓存；按 csId 索引；含 identity、diff sections、actions 历史、note
- `ApprovalActionStore` -- 动作进行中状态：`{ csId, action: 'approve'|'reject'|'request', phase: 'idle'|'pending'|'done'|'error' }`

#### projection

- `ApprovalChangeSetProjection` -- 从 core 原始 CS 数据派生视图模型：分组 diff sections、解析 old/new chip 对、计算 scope label

#### 跨域联动

- conversation 域 `ProposalBlock` 点击"前往审批" -> `InspectorRouter.transition('approval', csId)` -> approval store 加载详情
- approval 动作完成 -> 通知 novel store `invalidate(affectedScope)`、conversation store 重新投影相关消息（标注"已批准/已提交 rXXX"）
- schedule 域订阅 `ApprovalQueueStore` 派生"待审 todo"项

### 2.4 `domains/workspace/` -- 工作区域

**职责**：管理当前激活 workspace、recent 列表、选择/关闭流程、workspace 元信息展示。是其他所有域的"上下文根"。

#### 组件

| 组件 | 作用 |
|---|---|
| `WorkspaceFooting` | 侧栏底部：ws-mark（workspace 首字母彩色方块）+ ws-foot-name + ws-foot-meta；点击触发 workspace 切换 |
| `WorkspaceLabel` | 顶栏 workspace 名展示；含展开/折叠状态指示 |
| `WorkspaceRevisionMeta` | 顶栏修订元信息：当前 NovelRevision + 最后提交时间；mono 字体 |
| `WorkspaceSelectionDialog` | 已存在；选择 workspace 的模态；含 recent 列表 + 选择目录按钮 |
| `WorkspaceEmptyState` | 已存在；未选择 workspace 时的主区占位 |

#### hooks

- `useWorkspaceControllerSnapshot()` -- 已存在

#### store

- `WorkspaceController` -- 已存在；重构为 extends `ExternalStore`，统一快照接口
- `WorkspaceMetadataStore` -- 当前 workspace 的元信息（novelId/label/revision/lastCommitAt）；从 core `api.workspaces.metadata` 加载

#### 跨域联动

- `WorkspaceController` 的 active workspace 变化 -> shell 顶层 effect 触发所有域 store 的 `loadWorkspace(newId)`
- `WorkspaceMetadataStore` 提供数据给 topbar 的 `WorkspaceLabel` + `WorkspaceRevisionMeta`

### 2.5 `domains/schedule/` -- 计划域

**职责**：聚合 novel + approval + conversation 数据，产出"今日该做什么"的视图。**不持有独立数据源**，只做派生。

#### 组件

| 组件 | 作用 |
|---|---|
| `ScheduleStatRow` | 顶部统计行：渲染 `ScheduleStat[]`（叶子单元数 / 已实现数 / 阻塞数等） |
| `ScheduleStat` | 单统计项：num（大数字）+ lbl + note；danger 色用 var(--danger) |
| `ScheduleAxisFlow` | 规划轴/实现轴状态流图：规划轴 idea->outlined->ready，实现轴 pending->in-progress->completed->/abandoned |
| `ScheduleProgressCard` | 进度卡片容器；含 header + `ScheduleTodoList` 或 `ScheduleProgressTree` |
| `ScheduleTodoList` | 待办列表；按 status 分组（open/done） |
| `ScheduleTodoItem` | 单待办：check + t-title + t-meta + ttag（decision/approval/profile/writing） |
| `ScheduleProgressTree` | 大纲进度树（与 novel outline 同构，但简化：只显示 u-prog 进度 + 阻塞/搁置标注） |
| `ScheduleProgressUnit` | 单进度行：name + 双轴 status + u-prog（3/4） |
| `ScheduleAbandonedNote` | "已搁置：story-direction-changed · 被「X」取代" 横幅 |

#### hooks

- `useScheduleOverview(workspaceId)` -- 统计 + axis flow 数据
- `useScheduleTodos(workspaceId)` -- 待办列表
- `useScheduleProgress(workspaceId)` -- 进度树

#### store

- `ScheduleStore` extends `ExternalStore` -- **派生 store**；订阅 `NovelOverviewStore` + `ApprovalQueueStore` + `ConversationCatalogStore`，聚合产出 stats + todos + progress 快照
- `ScheduleTodoStore` -- 待办本地状态（已打开/已完成/隐藏）；不持久化

#### projection

- `ScheduleProjection` -- 派生逻辑：
  - stats = `novelOverview.counts` + 派生（阻塞数 = outline.blocked count）
  - todos = `approvalQueue` 中 pending 项 + novel 域缺失档案 + conversation 域需跟进项
  - progress = `novelOutline` 树 + 每个 unit 的实现状态聚合

#### 跨域联动

- 仅订阅其他域 store，不发起 core API 调用
- 点击 `ScheduleTodoItem` 中"去审批"链接 -> `InspectorRouter.transition('approval', csId)`

---

## 3. Shell 组合层 + GUI Renderer + 视觉系统 + 状态/测试策略（待补）

> 下一轮设计将覆盖：
>
> - `shell/topbar/` `shell/sidebar/` `shell/main/` `shell/inspector/` `shell/overlays/` 各组件作用
> - `@novel/gui/src/renderer/` 的组合根（DesktopNovelApp、ElectronFrontendPlatform、ElectronApiTransport、DesktopUiExtensions、与 Main/Preload 的集成点）
> - 视觉设计系统（design tokens 详细定义、组件视觉语言、dark mode 预留）
> - 状态管理策略（ExternalStore 约定、快照不可变性、订阅模式、并发与冲突处理）
> - 测试策略（单元测试、组件测试、契约测试、视觉冒烟）
> - 实施顺序（Phase 1-5）
