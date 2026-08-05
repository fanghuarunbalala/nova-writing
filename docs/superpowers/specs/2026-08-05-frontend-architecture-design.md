# Novel 前端架构设计 spec

## 文档元信息

- **文档状态**：完整 spec（已评审；演进策略确认"全新设计"；approval 域待定，后续再确定）
- **创建日期**：2026-08-05
- **设计依据**：`vendor/index.html` 设计原型 + 现有 `@novel/ui` 与 `@novel/gui` 代码
- **范围**：`@novel/ui`（共享 React 层）+ `@novel/gui/src/renderer`（桌面组合层）；`@novel/core` 前端契约保持稳定
- **实施原则**：可维护、可迭代、可整合优先；非 MVP；spec 是单一真相源；实现不允许偏离 spec
- **对齐原则**：`vendor/index.html` 设计原型是**视觉目标**（V1 全部表面与视觉细节以原型为准）；**代码架构**（分层、域、store、路由、样式体系）按本 spec 执行。两者冲突时：表面以原型为准，结构以 spec 为准。

---

## 0. 决策摘要

| 维度 | 决策 | 理由 |
|---|---|---|
| 演进策略 | 全新设计 | 现有 chat-first 单视图结构与原型多视图 + 审批 inspector + 双轴大纲不兼容；增量演进会留下结构性债务 |
| 覆盖范围 | `@novel/ui` + `@novel/gui/src/renderer` | core 前端契约已稳定且经过契约测试；重做 core 会扩大爆炸半径 |
| V1 表面 | 顶栏 + 侧栏 + 主区三视图 + overlays 全覆盖；审批 inspector 待定 | 用户明确要求 V1 覆盖原型全部表面；approval 域后续再确定，暂不列入实施约束 |
| 模块组织 | Approach B 域优先垂直切片 | 业务域是更稳定的分解轴；跨表面复用是常态；与 core projection 域切分一致 |
| 状态管理 | 外部 class store + `useSyncExternalStore` + immutable snapshot | 与 core 投影 store 一致；不引入新依赖；store 可在 React 外测试 |
| 样式 | CSS Modules + design tokens（CSS 变量，OKLCH） | 零运行时；原生作用域；与原型 CSS 风格直接对齐；Vite 原生支持 |
| 基础组件 | 自建 + Radix Primitives（Dialog/Dropdown/Tabs/Tooltip） | 可访问性补齐而不锁死视觉系统；控制 bundle 体积 |
| 视图路由 | 自定义状态机（MainViewRouter + InspectorRouter） | 桌面应用无 URL；状态机简单可测；避免 history API 兼容性 |
| 数据获取 | 自定义 hooks + `useSyncExternalStore` | 数据来自 core 投影/IPC 非 HTTP；保持栈精简 |
| 测试 | 单元 + 组件 + 契约 + 视觉冒烟 | 多层覆盖；契约测试已有 ScriptedApiTransport 基础 |
| 原型对齐 | `vendor/index.html` 是视觉目标；架构按本 spec | 表面/视觉细节以原型为准，防止单文件原型结构直接搬进代码；代码分层与状态管理以 spec 为准 |

> **决策状态（2026-08-05 用户评审）**：
> - ✅ 已确认：演进策略 = **全新设计**（现有 chat-first 单视图结构与原型多视图不兼容，不做增量演进）
> - ⏳ 待定：**approval 域**（含审批 inspector、Phase 2 轨道 C、1.5.2/1.5.3 审批相关流程）后续再确定；以下相关章节为参考设计，不作为实施约束

---

## 1. 架构总览

### 1.1 分层模型

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

### 1.2 依赖规则（强制）

- `domains/*` 可 import `shared/*` 与 `@novel/core`；**禁止** import `shell/*` 或其他域
- `shell/*` 可 import `domains/*` 与 `shared/*`；**禁止**直接 import `@novel/core/node` 或平台 API
- `shared/*` 只能 import `@novel/core` 与 React；**禁止** import 域或 shell
- `shared/platform/` 定义 port 接口，实现在 `gui/src/renderer` 内
- 任何层都不允许向上 import

**CI 强制**：通过 ESLint rule `no-restricted-imports` 检测违反；规则文件位于 `ui/.eslintrc.cjs`。

### 1.3 模块结构（@novel/ui/src/）

```
ui/src/
├─ app/
│  ├─ NovelApp.tsx               # 公共入口；组装 Provider 与 ApplicationShell
│  ├─ NovelAppProvider.tsx       # api/platform/extensions/logger context
│  └─ NovelAppContext.ts
├─ domains/
│  ├─ conversation/              # 对话域
│  ├─ novel/                     # 小说域
│  ├─ approval/                  # 审批域
│  ├─ workspace/                 # 工作区域
│  └─ schedule/                  # 计划域
├─ shell/
│  ├─ ApplicationShell.tsx       # 顶层壳
│  ├─ topbar/
│  ├─ sidebar/
│  ├─ main/
│  ├─ inspector/
│  └─ overlays/
├─ shared/
│  ├─ theme/
│  ├─ primitives/
│  ├─ platform/
│  ├─ state/
│  └─ routing/
├─ extensions/
├─ client/
└─ index.ts
```

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
  │conversation│    │  novel   │  │ approval │   │ schedule │      │ workspace│
  │ catalog$  │    │overview$ │  │ queue$   │   │ stats$   │      │ metadata$│
  │ projection$│   │ outline$ │  │ changeSet$│   │ todos$   │      │          │
  │           │    │manuscript$│ │          │   │ progress$│      │          │
  │           │    │ chars$   │  │          │   │          │      │          │
  │           │    │ locs$    │  │          │   │          │      │          │
  └─────┬────┘    └────┬─────┘  └────┬─────┘   └────┬─────┘      └────┬─────┘
        │              │             │              │                 │
        │  shell/ 通过 hook 订阅各域 store，组合渲染
        ▼              ▼             ▼              ▼                 ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │  shell/topbar  shell/sidebar  shell/main  shell/inspector  shell/overlays│
  └─────────────────────────────────────────────────────────────────────────┘
```

### 1.5 五大关键数据流

> 注：1.5.2（对话消息 -> 审批联动）与 1.5.3（审批通过 -> 小说域刷新）为 approval 相关参考流程，待 approval 域确定后重新确认。

#### 1.5.1 Workspace 激活流

```
用户选 Workspace
  -> WorkspaceController.open()
  -> activeWorkspace$ 变化
  -> shell/ApplicationShell 顶层 effect 检测
  -> 并行触发：
       conversationCatalogStore.loadWorkspace(id)
       novelOverviewStore.loadWorkspace(id)
       approvalQueueStore.loadWorkspace(id)
       workspaceMetadataStore.loadWorkspace(id)
  -> 各域独立从 @novel/core API 加载数据
  -> 各自 setSnapshot + notify
  -> shell 重新渲染
```

**协调原则**：shell 顶层 effect 是唯一允许跨域触发副作用的地方；域之间不直接调用。

#### 1.5.2 对话消息 -> 审批联动

```
conversation 域投影出 ProposalBlock（含 changeSetId）
  -> 用户点击 ProposalBlock 内"前往审批 Diff"
  -> 调用 InspectorRouter.transition('approval', changeSetId)
  -> shell/inspector/InspectorHost 检测路由变化
  -> 渲染 ApprovalInspectorPanel
  -> approval 域 useApprovalChangeSet(workspaceId, csId) 触发懒加载
  -> ApprovalChangeSetStore.load(csId) 从 core API 获取详情
  -> 渲染 diff
```

#### 1.5.3 审批通过 -> 小说域刷新

```
用户在 inspector 点击"批准"
  -> ApprovalActionStore.submit('approve', csId)
  -> 调用 core api.approval.approve(csId)
  -> 返回成功
  -> ApprovalQueueStore.remove(csId)
  -> ApprovalChangeSetStore.markResolved(csId, revision)
  -> 触发 NovelStore.invalidate(affectedScope)
  -> NovelStore 重新加载受影响实体
  -> ConversationProjectionStore 重新投影相关消息（标注"已批准/已提交 rXXX"）
  -> ScheduleStore 因订阅 approval/novel store 自动重算
```

#### 1.5.4 内容视图选中 -> inspector 详情

```
用户在 ContentSurface 点大纲节点
  -> StoryOutlineTreeStore.select(unitId)
  -> shell 调 InspectorRouter.transition('outlineUnit', unitId)
  -> inspector 渲染 OutlineUnitInspectorPanel
  -> panel 调 useOutlineUnitDetail(workspaceId, unitId)
  -> OutlineUnitStore 加载详情（若未缓存）
```

#### 1.5.5 跨域聚合（schedule）

```
ScheduleStore 订阅：
  - NovelOverviewStore
  - ApprovalQueueStore
  - ConversationCatalogStore

任一上游 store notify -> ScheduleStore.recompute()
  -> ScheduleProjection.derive(上游快照们)
  -> 派生 stats / todos / progress
  -> setSnapshot（若 deep-equal 上一快照则复用引用，避免无谓重渲染）
  -> notify
```

### 1.6 跨域协调原则（强制）

域之间不直接 import 对方，只通过三种机制协调：

1. **共享 core API**：数据真实来源；域通过 hook 调 core API
2. **shell 层 effect**：副作用协调（如 workspace 切换触发各域 load）
3. **派生 store**：schedule 域订阅其他域 store 的快照，派生新快照

**禁止**：
- 域 A 直接 import 域 B 的 store
- 域 A 直接调用域 B 的方法
- 域 A 通过事件总线通知域 B

---

## 2. 共享基础设施（shared/）

### 2.1 `shared/theme/`

#### 2.1.1 `tokens.css` -- 完整 design tokens

```css
:root {
  /* ============ 颜色（OKLCH） ============ */
  --color-bg:            oklch(97.9% 0.003 85);
  --color-surface:       oklch(99.8% 0.0015 85);
  --color-surface-2:     oklch(96.2% 0.004 82);
  --color-fg:            oklch(30% 0.009 46);
  --color-muted:         oklch(52% 0.009 54);
  --color-faint:         oklch(60% 0.009 58);
  --color-border:        oklch(92.4% 0.003 82);
  --color-border-strong: oklch(86.4% 0.006 72);
  --color-orange:        oklch(73% 0.068 60);
  --color-accent:        oklch(55% 0.072 42);
  --color-red:           oklch(58% 0.075 32);
  --color-accent-ink:    oklch(47% 0.062 41);
  --color-success:       oklch(52% 0.07 156);
  --color-success-bg:    oklch(97.2% 0.011 156);
  --color-warn:          oklch(59% 0.07 80);
  --color-warn-bg:       oklch(97.1% 0.011 86);
  --color-danger:        oklch(54% 0.068 32);
  --color-danger-bg:     oklch(97.1% 0.009 33);
  --color-info:          oklch(54% 0.05 235);
  --color-info-bg:       oklch(97.2% 0.007 236);

  /* ============ 渐变 ============ */
  --grad-accent: linear-gradient(
    105deg,
    var(--color-orange) 0%,
    var(--color-accent) 48%,
    var(--color-red) 100%
  );

  /* ============ 字体 ============ */
  --font-display: "PingFang SC", "Hiragino Sans GB", "Noto Sans SC",
    "Source Han Sans SC", "Microsoft YaHei", system-ui, sans-serif;
  --font-body:    "PingFang SC", "Hiragino Sans GB", "Noto Sans SC",
    "Source Han Sans SC", "Microsoft YaHei", system-ui, sans-serif;
  --font-mono:    "SF Mono", ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace;

  /* ============ 字号 ============ */
  --fs-display: 19px;
  --fs-h1:      16px;
  --fs-h2:      14px;
  --fs-body:    13.5px;
  --fs-meta:    11.5px;
  --fs-mono:    11px;
  --fs-xs:      10.5px;

  /* ============ 字重 ============ */
  --fw-regular: 400;
  --fw-medium:  550;
  --fw-semibold: 650;
  --fw-bold:    700;
  --fw-heavy:   800;

  /* ============ 间距（4px scale） ============ */
  --space-0:  0;
  --space-1:  4px;
  --space-2:  8px;
  --space-3:  12px;
  --space-4:  16px;
  --space-5:  20px;
  --space-6:  24px;
  --space-8:  32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;

  /* ============ 圆角 ============ */
  --radius-xs:    5px;
  --radius-sm:    6px;
  --radius-md:    9px;
  --radius-lg:    14px;
  --radius-pill:  999px;

  /* ============ 阴影 ============ */
  --shadow-1: 0 1px 2px rgba(40, 22, 10, 0.04),
              0 8px 24px rgba(40, 22, 10, 0.045);
  --shadow-2: 0 10px 28px rgba(40, 22, 10, 0.13);

  /* ============ 动画时长 ============ */
  --duration-fast: 0.15s;
  --duration-base: 0.22s;
  --duration-slow: 0.4s;

  /* ============ 缓动 ============ */
  --ease-out:     cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-out:  cubic-bezier(0.65, 0, 0.35, 1);

  /* ============ 布局尺寸 ============ */
  --topbar-height:       56px;
  --subhead-height:      58px;
  --sidebar-width:       292px;
  --sidebar-width-collapsed: 0;
  --inspector-width-default: 384px;
  --inspector-width-min: 300px;
  --inspector-width-max: 680px;
  --inspector-width-wide: 480px;
  --inspector-width-narrow: 344px;
}

> 布局尺寸已按 `vendor/index.html` 原型校准：inspector 默认 384px（原型 `--insp-w` 默认，
> 窄屏 344px）、拖拽范围 [300, 680]（原型 MIN=300 / BASE_MAX=680）。

/* Dark mode 预留（V1 不实现，但结构支持） */
[data-theme="dark"] {
  /* color tokens 重写为 dark 调色板；V2 实现 */
}
```

#### 2.1.2 `global.css`

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body, #root { height: 100%; }

body {
  background:
    radial-gradient(
      1200px 780px at 14% -8%,
      color-mix(in oklab, var(--color-orange) 6%, transparent),
      transparent 62%
    ),
    var(--color-bg);
  background-attachment: fixed;
  color: var(--color-fg);
  font-family: var(--font-body);
  font-size: var(--fs-body);
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

a { color: inherit; text-decoration: none; }
button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

.sr-only {
  position: absolute; width: 1px; height: 1px;
  padding: 0; margin: -1px; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

.kicker {
  font-family: var(--font-mono);
  font-size: var(--fs-mono);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-faint);
}
```

#### 2.1.3 `animations.css`

```css
@keyframes grad-flow {
  0%, 100% { background-position: 0% 50%; }
  50%      { background-position: 100% 50%; }
}

@keyframes view-in {
  from { opacity: 0; transform: translateY(3px); }
  to   { opacity: 1; transform: none; }
}

@keyframes conv-spin {
  to { transform: rotate(360deg); }
}

@keyframes msg-enter {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: none; }
}

@keyframes toast-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: none; }
}

/* 通用动画 utility class */
.anim-grad-flow { animation: grad-flow 7s ease-in-out infinite; }
.anim-view-in   { animation: view-in var(--duration-base) var(--ease-out); }
.anim-msg-enter { animation: msg-enter var(--duration-base) var(--ease-out); }
.anim-toast-in  { animation: toast-in var(--duration-fast) var(--ease-out); }
```

#### 2.1.4 `ThemeProvider.tsx`

```tsx
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type Theme = "light" | "dark";

interface ThemeContextValue {
  readonly theme: Theme;
  readonly setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
  readonly initialTheme?: Theme;
  readonly children: ReactNode;
}

/**
 * 设置 <html data-theme="..."> 根属性；提供 useTheme() 读取与切换。
 * V1 仅实现 light；dark mode 预留接口。
 */
export function ThemeProvider({ initialTheme = "light", children }: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const value = useMemo(() => ({ theme, setTheme }), [theme]);
  return (
    <ThemeContext.Provider value={value}>
      <html data-theme={theme}>{children}</html>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === null) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
```

### 2.2 `shared/primitives/`

每个 primitive 配套 `*.module.css`。

#### 2.2.1 Button

```tsx
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "ghost-danger" | "link";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly leadingIcon?: ReactNode;
  readonly trailingIcon?: ReactNode;
  readonly loading?: boolean;
  readonly fullWidth?: boolean;
  readonly children?: ReactNode;
}
```

| variant | 视觉 | 用途 |
|---|---|---|
| primary | accent 渐变背景 + 白字 | 主操作（发送、批准） |
| secondary | surface 背景 + border | 次操作（取消） |
| ghost | transparent + hover surface-2 | 工具栏按钮 |
| ghost-danger | transparent + hover danger-bg + danger 字色 | 删除/拒绝 hover |
| link | transparent + accent-ink + underline on hover | 行内链接 |

| size | padding | font-size |
|---|---|---|
| sm | 5px 10px | 12px |
| md | 7px 12px | 13px |
| lg | 9px 16px | 14px |

#### 2.2.2 IconButton

```tsx
export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly label: string; // aria-label，必填
  readonly size?: "sm" | "md";
  readonly children: ReactNode; // icon
}
```

固定 34x34（md）或 28x28（sm）；border + border-radius 9px。

#### 2.2.3 Dialog

基于 `@radix-ui/react-dialog`。

```tsx
export interface DialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title?: ReactNode;
  readonly description?: ReactNode;
  readonly size?: "sm" | "md" | "lg" | "xl";
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}
```

| size | max-width |
|---|---|
| sm | 400px |
| md | 560px |
| lg | 720px |
| xl | 960px |

含焦点陷阱、ESC 关闭、点击遮罩关闭；content 居中。

#### 2.2.4 Dropdown

基于 `@radix-ui/react-dropdown-menu`。

```tsx
export interface DropdownProps {
  readonly trigger: ReactNode;
  readonly children: ReactNode; // DropdownItem 列表
  readonly align?: "start" | "center" | "end";
  readonly side?: "top" | "right" | "bottom" | "left";
}

export interface DropdownItemProps {
  readonly icon?: ReactNode;
  readonly label: ReactNode;
  readonly onSelect: () => void;
  readonly danger?: boolean;
  readonly disabled?: boolean;
}

export interface DropdownSeparatorProps {}
```

#### 2.2.5 Tabs

基于 `@radix-ui/react-tabs`。

```tsx
export interface TabsProps {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly tabs: readonly TabItem[];
  readonly children: ReactNode; // TabsContent 列表
  readonly variant?: "line" | "pill";
}

export interface TabItem {
  readonly value: string;
  readonly label: ReactNode;
  readonly count?: number;
  readonly disabled?: boolean;
}

export interface TabsContentProps {
  readonly value: string;
  readonly children: ReactNode;
}
```

#### 2.2.6 Tooltip

基于 `@radix-ui/react-tooltip`。

```tsx
export interface TooltipProps {
  readonly content: ReactNode;
  readonly side?: "top" | "right" | "bottom" | "left";
  readonly delay?: number; // ms，默认 300
  readonly children: ReactNode;
}
```

#### 2.2.7 Separator

```tsx
export interface SeparatorProps {
  readonly orientation?: "horizontal" | "vertical";
  readonly variant?: "soft" | "strong";
}
```

#### 2.2.8 DragHandle

```tsx
export interface DragHandleProps {
  readonly orientation: "horizontal" | "vertical";
  readonly onResize: (deltaPx: number) => void;
  readonly onResizeEnd?: () => void;
  readonly ariaLabel: string;
  readonly min?: number;
  readonly max?: number;
}
```

实现：pointer events；拖拽时全局监听 pointermove，每次 delta 调 onResize；rAF 节流。

#### 2.2.9 Spinner

```tsx
export interface SpinnerProps {
  readonly size?: "xs" | "sm" | "md";
  readonly variant?: "default" | "danger";
}
```

#### 2.2.10 Badge

```tsx
export interface BadgeProps {
  readonly count: number;
  readonly variant?: "default" | "warn" | "danger" | "success";
  readonly max?: number; // 超过显示 max+
}
```

#### 2.2.11 Pill

```tsx
export type PillVariant = "pending" | "approved" | "changed" | "info";

export interface PillProps {
  readonly variant: PillVariant;
  readonly children: ReactNode;
}
```

| variant | bg | fg |
|---|---|---|
| pending | warn-bg | warn |
| approved | success-bg | success |
| changed | danger-bg | danger |
| info | info-bg | info |

#### 2.2.12 Avatar

```tsx
export type AvatarVariant = "user" | "agent";

export interface AvatarProps {
  readonly variant: AvatarVariant;
  readonly text: string; // 1-2 字符
  readonly size?: "sm" | "md";
}
```

#### 2.2.13 Kbd

```tsx
export interface KbdProps {
  readonly children: ReactNode; // 如 "Ctrl+Shift+P"
}
```

#### 2.2.14 Text

```tsx
export type TextSize = "xs" | "sm" | "md" | "lg" | "xl";
export type TextWeight = "regular" | "medium" | "semibold" | "bold" | "heavy";
export type TextColor = "fg" | "muted" | "faint" | "accent" | "danger" | "success" | "warn";

export interface TextProps {
  readonly size?: TextSize;
  readonly weight?: TextWeight;
  readonly color?: TextColor;
  readonly as?: "span" | "p" | "div";
  readonly mono?: boolean;
  readonly children: ReactNode;
}
```

#### 2.2.15 Icon

基于 `lucide-react`。

```tsx
import type { LucideIcon } from "lucide-react";

export interface IconProps {
  readonly icon: LucideIcon;
  readonly size?: "xs" | "sm" | "md" | "lg";
  readonly strokeWidth?: number;
  readonly color?: TextColor;
}
```

| size | px |
|---|---|
| xs | 12 |
| sm | 14 |
| md | 16 |
| lg | 20 |

### 2.3 `shared/platform/`

#### 2.3.1 FrontendPlatform 接口

```ts
export interface FrontendPlatform {
  readonly capabilities: PlatformCapabilities;
  readonly files: FileSelectionPort;
  readonly clipboard: ClipboardPort;
  readonly notifications: NotificationPort;
}

export interface PlatformCapabilities {
  readonly fileSelection: boolean;
  readonly clipboard: boolean;
  readonly notifications: boolean;
  readonly workspacePicker: boolean;
  readonly workspaceSession: boolean;
}
```

#### 2.3.2 Port 接口

```ts
export interface FileSelectionPort {
  selectFile(options?: FileSelectionOptions): Promise<FileSelectionResult | undefined>;
  selectDirectory(options?: FileSelectionOptions): Promise<FileSelectionResult | undefined>;
}

export interface FileSelectionOptions {
  readonly multiple?: boolean;
  readonly accept?: readonly string[];
}

export interface FileSelectionResult {
  readonly referenceId: string; // opaque frontend reference
  readonly label: string;
}

export interface ClipboardPort {
  writeText(text: string): Promise<void>;
  readText(): Promise<string>;
}

export interface NotificationPort {
  notify(options: NotificationOptions): Promise<void>;
}

export interface NotificationOptions {
  readonly title: string;
  readonly body?: string;
  readonly kind?: "info" | "success" | "warn" | "danger";
}

export interface WorkspacePickerPort {
  pickWorkspace(): Promise<WorkspacePickerResult | undefined>;
}

export interface WorkspacePickerResult {
  readonly referenceId: string;
  readonly label: string;
}

export interface WorkspaceSessionPort {
  openSession(referenceId: string): Promise<WorkspaceSessionResult>;
  listRecent(): Promise<readonly WorkspaceSessionSummary[];
  closeCurrent(): Promise<void>;
}

export interface WorkspaceSessionResult {
  readonly id: string;
  readonly label: string;
}

export interface WorkspaceSessionSummary {
  readonly id: string;
  readonly label: string;
  readonly lastOpenedAt: number;
}
```

#### 2.3.3 FrontendPlatformContext

```tsx
import { createContext, useContext, type ReactNode } from "react";

export interface FrontendPlatformContextValue {
  readonly platform: FrontendPlatform | null;
}

export const FrontendPlatformContext = createContext<FrontendPlatformContextValue>({
  platform: null,
});

export function useFrontendPlatform(): FrontendPlatform {
  const ctx = useContext(FrontendPlatformContext);
  if (ctx.platform === null) {
    throw new Error("FrontendPlatform not provided; wrap in NovelAppProvider");
  }
  return ctx.platform;
}
```

### 2.4 `shared/state/`

#### 2.4.1 ExternalStore（完整实现）

```ts
/**
 * 所有域 store 的抽象基类。
 * 约定：subscribe 与 getSnapshot 必须是箭头函数属性（保证 useSyncExternalStore 引用稳定）。
 * 约定：所有快照必须 immutable；通过 setSnapshot 自动 freeze。
 */
export abstract class ExternalStore<S> {
  protected snapshot: S;
  private readonly listeners = new Set<() => void>();

  protected constructor(initial: S) {
    this.snapshot = ImmutableSnapshot.freeze(initial);
  }

  /** 订阅快照变化；返回取消订阅函数。 */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** 获取当前快照（immutable）。 */
  readonly getSnapshot = (): S => this.snapshot;

  /**
   * 替换快照并通知所有订阅者。
   * 若 next 与当前快照 Object.is 相等则跳过。
   * 自动深度 freeze。
   */
  protected setSnapshot(next: S): void {
    if (Object.is(next, this.snapshot)) return;
    this.snapshot = ImmutableSnapshot.freeze(next);
    this.notify();
  }

  /** 仅触发通知（用于快照内部 mutable 引用未变但内容已改的场景；不推荐常用）。 */
  protected notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
```

#### 2.4.2 ImmutableSnapshot（完整实现）

```ts
/**
 * 深度冻结工具。保证快照不可变，防止外部误改导致 React 缓存失效。
 */
export const ImmutableSnapshot = {
  freeze<T>(value: T): T {
    if (value === null || typeof value !== "object") return value;
    if (Object.isFrozen(value)) return value;
    if (Array.isArray(value)) {
      Object.freeze(value);
      for (const item of value) {
        this.freeze(item);
      }
      return value;
    }
    Object.freeze(value);
    const keys = Object.keys(value as Record<string, unknown>);
    for (const key of keys) {
      this.freeze((value as Record<string, unknown>)[key]);
    }
    return value;
  },

  /** 深比较两个值是否相等；用于派生 store 避免无谓 notify。 */
  deepEqual<T>(a: T, b: T): boolean {
    if (Object.is(a, b)) return true;
    if (a === null || b === null) return false;
    if (typeof a !== "object" || typeof b !== "object") return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      if (a.length !== (b as unknown[]).length) return false;
      for (let i = 0; i < a.length; i++) {
        if (!this.deepEqual(a[i], (b as unknown[])[i])) return false;
      }
      return true;
    }
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b as object);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!this.deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false;
    }
    return true;
  },
};
```

#### 2.4.3 useExternalStore

```ts
import { useSyncExternalStore } from "react";

/**
 * useSyncExternalStore 的封装。提供类型推断。
 * 用法：const snapshot = useExternalStore(store);
 */
export function useExternalStore<S>(
  store: {
    readonly subscribe: (listener: () => void) => () => void;
    readonly getSnapshot: () => S;
  },
): S {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
```

#### 2.4.4 TaskSerializer

```ts
/**
 * 异步任务串行器。保证同一资源的多个 UI 命令不会并发执行。
 * 用法：const serializer = new TaskSerializer();
 *       serializer.run(async () => { ... });
 */
export class TaskSerializer {
  private chain: Promise<unknown> = Promise.resolve();

  /** 将 task 排队执行；返回 task 的 Promise。 */
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(() => task());
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result as Promise<T>;
  }

  /** 重置链（不取消正在执行的任务）。 */
  clear(): void {
    this.chain = Promise.resolve();
  }
}
```

### 2.5 `shared/routing/`

#### 2.5.1 MainViewRouter

```ts
export type MainViewState = "chat" | "content" | "schedule";

export interface MainViewSnapshot {
  readonly state: MainViewState;
  readonly canBack: boolean;
  readonly canForward: boolean;
}

/**
 * 主区视图状态机。state ∈ {chat, content, schedule}。
 * 维护双栈 history 支持 back/forward。不使用 URL。
 */
export class MainViewRouter extends ExternalStore<MainViewSnapshot> {
  private backStack: MainViewState[] = [];
  private forwardStack: MainViewState[] = [];

  constructor(initial: MainViewState = "chat") {
    super({ state: initial, canBack: false, canForward: false });
  }

  transition(next: MainViewState): void {
    const current = this.snapshot.state;
    if (next === current) return;
    this.backStack.push(current);
    this.forwardStack = [];
    this.setSnapshot({
      state: next,
      canBack: this.backStack.length > 0,
      canForward: false,
    });
  }

  back(): void {
    if (this.backStack.length === 0) return;
    const prev = this.backStack.pop()!;
    this.forwardStack.push(this.snapshot.state);
    this.setSnapshot({
      state: prev,
      canBack: this.backStack.length > 0,
      canForward: this.forwardStack.length > 0,
    });
  }

  forward(): void {
    if (this.forwardStack.length === 0) return;
    const next = this.forwardStack.pop()!;
    this.backStack.push(this.snapshot.state);
    this.setSnapshot({
      state: next,
      canBack: this.backStack.length > 0,
      canForward: this.forwardStack.length > 0,
    });
  }
}
```

#### 2.5.2 InspectorRouter

```ts
export type InspectorState =
  | { readonly kind: "closed" }
  | { readonly kind: "approval"; readonly changeSetId: string }
  | { readonly kind: "entity"; readonly entityType: "character" | "location"; readonly entityId: string }
  | { readonly kind: "conversation"; readonly conversationId: string }
  | { readonly kind: "outlineUnit"; readonly unitId: string };

export type InspectorMode = "closed" | "normal" | "wide";

export interface InspectorSnapshot {
  readonly state: InspectorState;
  readonly mode: InspectorMode;
}

export class InspectorRouter extends ExternalStore<InspectorSnapshot> {
  constructor() {
    super({ state: { kind: "closed" }, mode: "closed" });
  }

  transition(state: InspectorState, mode: InspectorMode = "normal"): void {
    this.setSnapshot({ state, mode });
  }

  close(): void {
    this.setSnapshot({ state: { kind: "closed" }, mode: "closed" });
  }

  setMode(mode: InspectorMode): void {
    if (this.snapshot.state.kind === "closed" && mode !== "closed") return;
    this.setSnapshot({ ...this.snapshot, mode });
  }
}
```

#### 2.5.3 hooks

```ts
export function useMainView(router: MainViewRouter): MainViewSnapshot {
  return useExternalStore(router);
}

export function useInspectorRoute(router: InspectorRouter): InspectorSnapshot {
  return useExternalStore(router);
}
```

---

## 3. 业务域详细设计（domains/）

每个域遵循同一结构：职责 -> 组件（含 props） -> hooks（含签名） -> store（含 snapshot + 方法） -> projection -> 跨域联动。

### 3.1 `domains/conversation/` -- 对话域

**职责**：管理对话列表、对话内消息时间线、流式草稿、结构化卡片（think/proposal/diff/quote/table/plan）、composer 输入。是用户与 Novel Writer 交互的主入口。

#### 3.1.1 目录结构

```
domains/conversation/
├─ index.ts
├─ components/
│  ├─ ConversationTimeline.tsx
│  ├─ ConversationTimeline.module.css
│  ├─ UserMessage.tsx
│  ├─ AssistantMessage.tsx
│  ├─ ThinkBlock.tsx
│  ├─ ThinkLine.tsx
│  ├─ ProposalBlock.tsx
│  ├─ ProposalOp.tsx
│  ├─ MessageReference.tsx
│  ├─ ConversationComposer.tsx
│  ├─ ComposerModeBar.tsx
│  ├─ GenStatus.tsx
│  ├─ ChatEmptyState.tsx
│  ├─ ConversationList.tsx
│  ├─ ConversationListItem.tsx
│  ├─ ConversationItemMenu.tsx
│  └─ NewConversationButton.tsx
├─ hooks/
│  ├─ useConversationCatalog.ts
│  ├─ useConversationProjection.ts
│  ├─ useConversationRuntimeStatus.ts
│  └─ useComposerDraft.ts
├─ store/
│  ├─ ConversationCatalogStore.ts
│  └─ ComposerDraftStore.ts
├─ projection/
│  ├─ ConversationTimelineItem.ts
│  ├─ AssistantDraftProjection.ts
│  └─ ConversationCardDescriptor.ts
└─ cards/
   ├─ ConversationCardRendererRegistry.ts
   ├─ ConversationCardProjectorRegistry.ts
   └─ renderers/
      ├─ TextCardRenderer.tsx
      ├─ ProposalCardRenderer.tsx
      ├─ DiffCardRenderer.tsx
      ├─ TableCardRenderer.tsx
      ├─ QuoteCardRenderer.tsx
      └─ PlanCardRenderer.tsx
```

#### 3.1.2 组件

##### ConversationTimeline

```tsx
export interface ConversationTimelineProps {
  readonly conversationId: string;
  readonly items: readonly ConversationTimelineItem[];
  readonly streamingSequence?: number; // 流式中的消息 sequence
  readonly onMessageReferenceClick?: (reference: MessageReference) => void;
  readonly onProposalAction?: (changeSetId: string, action: "approve" | "reject" | "view-diff") => void;
}
```

行为：
- 按 sequence 排序渲染 items
- 新消息到达时自动滚动到底部（除非用户主动上滚）
- 虚拟化：消息 >200 条时启用窗口化渲染
- 空对话时渲染 `ChatEmptyState`

##### UserMessage

```tsx
export interface UserMessageProps {
  readonly sequence: number;
  readonly text: string; // 含 <character id="x">name</character> 等内联标记
  readonly timestamp: number;
  readonly onReferenceClick?: (reference: MessageReference) => void;
}
```

DOM：`<div class="msg user"><Avatar variant="user" text="我" /><div class="msg-body"><div class="msg-head"><span>你</span><time>...</time></div><div class="msg-text">...</div></div></div>`

文本中的 `<character>` / `<location>` / `<outline>` 标记解析为 `MessageReference` chip。

##### AssistantMessage

```tsx
export interface AssistantMessageProps {
  readonly sequence: number;
  readonly agentLabel: string;
  readonly timestamp: number;
  readonly approvalState?: "generating" | "completed" | "submitted" | "failed";
  readonly revision?: string; // "r039"
  readonly thinkLines?: readonly ThinkLineData[];
  readonly text: string;
  readonly cards?: readonly ConversationCardDescriptor[];
  readonly streaming?: boolean;
  readonly onCardAction?: (cardId: string, action: string, payload?: unknown) => void;
}

export interface ThinkLineData {
  readonly id: string;
  readonly text: string;
  readonly tag?: "伏笔" | "视角" | "地点" | "变更" | "语言" | "节奏" | "一致性";
}
```

##### ThinkBlock

```tsx
export interface ThinkBlockProps {
  readonly lines: readonly ThinkLineData[];
  readonly expanded: boolean;
  readonly streaming?: boolean;
  readonly onToggle: () => void;
}
```

行为：streaming 时自动展开；非 streaming 时折叠，点击切换。

##### ProposalBlock

```tsx
export interface ProposalOpData {
  readonly id: string;
  readonly mark: "add" | "mod" | "del" | "move" | "plan";
  readonly description: ReactNode;
  readonly kind: "manuscript" | "outline" | "character" | "location" | "todo" | "plan" | "scope";
}

export interface ProposalBlockProps {
  readonly tag: "plan" | "proposal" | "applied";
  readonly title: string;
  readonly meta?: string; // "r041 -> r042" / "仅规划 · 未产生变更"
  readonly ops: readonly ProposalOpData[];
  readonly changeSetId?: string;
  readonly footActions?: ReactNode;
  readonly onViewDiff?: (changeSetId: string) => void;
}
```

##### ConversationComposer

```tsx
export type ComposerMode = "chat" | "plan" | "rewrite" | "continue";

export interface ConversationComposerProps {
  readonly conversationId: string;
  readonly enabled: boolean; // runtime connected
  readonly onSend: (input: ComposerInput) => void;
  readonly onOpenReference?: (target: ComposerReferenceTarget) => void;
}

export interface ComposerInput {
  readonly text: string;
  readonly mode: ComposerMode;
  readonly references: readonly ComposerReference[];
}

export interface ComposerReference {
  readonly kind: "character" | "location" | "outline";
  readonly id: string;
  readonly label: string;
}

export interface ComposerReferenceTarget {
  readonly kind: "character" | "location" | "outline";
  readonly id: string;
}
```

##### ComposerModeBar

```tsx
export interface ComposerModeBarProps {
  readonly mode: ComposerMode;
  readonly onChange: (mode: ComposerMode) => void;
  readonly disabled?: boolean;
}
```

##### GenStatus

```tsx
export interface GenStatusProps {
  readonly phase: "idle" | "streaming" | "thinking" | "completed" | "failed";
  readonly stage?: string; // "正在思考..." / "正在生成正文..."
  readonly error?: string;
  readonly onRetry?: () => void;
}
```

##### ConversationList

```tsx
export interface ConversationListProps {
  readonly conversations: readonly ConversationListItemData[];
  readonly activeId?: string;
  readonly onSelect: (id: string) => void;
  readonly onCreate?: () => void;
  readonly onRename?: (id: string, title: string) => void;
  readonly onPin?: (id: string, pinned: boolean) => void;
  readonly onDelete?: (id: string) => void;
}

export interface ConversationListItemData {
  readonly id: string;
  readonly title: string;
  readonly agentLabel: string;
  readonly lastActivityAt: number;
  readonly status?: "generating" | "failed";
  readonly pinned?: boolean;
}
```

##### ConversationListItem

渲染单个对话项；含 status 指示器（generating 显示 spinner，failed 显示红点）+ ⋯ 菜单按钮。

##### ConversationItemMenu

基于 `Dropdown` primitive；items: 重命名 / 置顶切换 / 删除。

##### NewConversationButton

```tsx
export interface NewConversationButtonProps {
  readonly onClick: () => void;
  readonly disabled?: boolean;
}
```

#### 3.1.3 hooks

```ts
export function useConversationCatalog(): {
  readonly snapshot: ConversationCatalogSnapshot;
  readonly createConversation: () => Promise<string>;
  readonly selectConversation: (id: string) => void;
  readonly renameConversation: (id: string, title: string) => Promise<void>;
  readonly deleteConversation: (id: string) => Promise<void>;
  readonly pinConversation: (id: string, pinned: boolean) => Promise<void>;
};

export function useConversationProjection(
  conversationId: string,
  options?: { readonly cardProjectors?: ConversationCardProjectorRegistry },
): {
  readonly snapshot: ConversationProjectionSnapshot;
  readonly enqueue: (input: ComposerInput) => Promise<void>;
  readonly resume: () => void;
  readonly controller?: ConversationProjectionController;
};

export function useConversationRuntimeStatus(conversationId: string): {
  readonly state: "idle" | "live" | "disconnected" | "failed";
  readonly currentRun?: { readonly runId: string; readonly turn: number };
  readonly retry: () => void;
};

export function useComposerDraft(conversationId: string): {
  readonly draft: ComposerDraft;
  readonly setText: (text: string) => void;
  readonly setMode: (mode: ComposerMode) => void;
  readonly addReference: (ref: ComposerReference) => void;
  readonly removeReference: (id: string) => void;
  readonly clear: () => void;
};
```

#### 3.1.4 store

##### ConversationCatalogStore

```ts
export interface ConversationCatalogSnapshot {
  readonly phase: "idle" | "loading" | "ready" | "error";
  readonly workspaceId: string | undefined;
  readonly conversations: readonly ConversationListItemData[];
  readonly activeConversationId: string | undefined;
  readonly error: ConversationCatalogError | undefined;
}

export interface ConversationCatalogError {
  readonly code: "load-failed" | "create-failed" | "delete-failed" | "network";
  readonly message: string;
  readonly retryable: boolean;
}

export class ConversationCatalogStore extends ExternalStore<ConversationCatalogSnapshot> {
  constructor(deps: { readonly api: NovelApiClient; readonly logger: Logger });

  loadWorkspace(workspaceId: string): Promise<void>;
  selectConversation(id: string): void;
  createConversation(): Promise<string>;
  renameConversation(id: string, title: string): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  pinConversation(id: string, pinned: boolean): Promise<void>;
  clearWorkspace(): void;
  retry(): Promise<void>;
}
```

并发：所有 mutation 经 `TaskSerializer` 串行；workspace 切换时 `clearWorkspace` + `loadWorkspace` 串行。

##### ComposerDraftStore

```ts
export interface ComposerDraft {
  readonly conversationId: string;
  readonly text: string;
  readonly mode: ComposerMode;
  readonly references: readonly ComposerReference[];
  readonly updatedAt: number;
}

export class ComposerDraftStore extends ExternalStore<readonly ComposerDraft[]> {
  getDraft(conversationId: string): ComposerDraft;
  setText(conversationId: string, text: string): void;
  setMode(conversationId: string, mode: ComposerMode): void;
  addReference(conversationId: string, ref: ComposerReference): void;
  removeReference(conversationId: string, id: string): void;
  clear(conversationId: string): void;
}
```

进程内持久化（已存在）；不写 core。

#### 3.1.5 projection

##### ConversationTimelineItem

```ts
export type ConversationTimelineItem =
  | { readonly kind: "user"; readonly sequence: number; readonly text: string; readonly timestamp: number }
  | { readonly kind: "assistant"; readonly sequence: number; readonly agentLabel: string; readonly timestamp: number;
      readonly approvalState?: "generating" | "completed" | "submitted" | "failed";
      readonly revision?: string;
      readonly thinkLines: readonly ThinkLineData[];
      readonly text: string;
      readonly cards: readonly ConversationCardDescriptor[];
      readonly streaming: boolean; }
  | { readonly kind: "system"; readonly sequence: number; readonly text: string; readonly timestamp: number };
```

##### AssistantDraftProjection

```ts
export interface AssistantDraftProjection {
  readonly sequence: number;
  readonly deltas: readonly string[]; // ordered
  readonly terminal: string | undefined; // 最终文本（流式完成时）
  readonly phase: "streaming" | "completed" | "failed" | "cancelled";
}
```

##### ConversationCardDescriptor

```ts
export type ConversationCardDescriptor =
  | { readonly kind: "text"; readonly id: string; readonly content: TextCardContent }
  | { readonly kind: "proposal"; readonly id: string; readonly content: ProposalCardContent }
  | { readonly kind: "diff"; readonly id: string; readonly content: DiffCardContent }
  | { readonly kind: "table"; readonly id: string; readonly content: TableCardContent }
  | { readonly kind: "quote"; readonly id: string; readonly content: QuoteCardContent }
  | { readonly kind: "plan"; readonly id: string; readonly content: PlanCardContent };

export interface TextCardContent {
  readonly richText: RichText; // 含 <b>/<hl>/<code>/<character>/<location>/<outline> 标记
}

export interface ProposalCardContent {
  readonly tag: "plan" | "proposal" | "applied";
  readonly title: string;
  readonly meta?: string;
  readonly ops: readonly ProposalOpData[];
  readonly changeSetId?: string;
}

export interface DiffCardContent {
  readonly changeSetId: string;
  readonly summary: string;
}

export interface TableCardContent {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly RichText[])[];
}

export interface QuoteCardContent {
  readonly text: RichText;
  readonly attribution?: string;
}

export interface PlanCardContent {
  readonly ops: readonly ProposalOpData[]; // only todo/plan/scope kinds
}

export type RichText =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "bold"; readonly children: readonly RichText[] }
  | { readonly kind: "highlight"; readonly children: readonly RichText[] }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "reference"; readonly refKind: "character" | "location" | "outline"; readonly id: string; readonly label: string };
```

#### 3.1.6 cards/（卡片渲染器注册）

每个 renderer 实现：

```ts
export interface ConversationCardRenderer<C extends ConversationCardDescriptor = ConversationCardDescriptor> {
  readonly kind: C["kind"];
  render(props: { readonly card: C; readonly onAction?: (action: string, payload?: unknown) => void }): ReactNode;
}
```

注册到 `ConversationCardRendererRegistry`：

```ts
export class ConversationCardRendererRegistry {
  register(renderer: ConversationCardRenderer): void;
  get(kind: string): ConversationCardRenderer | undefined;
}
```

默认注册：TextCardRenderer、ProposalCardRenderer、DiffCardRenderer、TableCardRenderer、QuoteCardRenderer、PlanCardRenderer。

#### 3.1.7 跨域联动

- 点击 `MessageReference` -> 调用 `onReferenceClick` 回调 -> shell 调 `InspectorRouter.transition('entity', {kind, id})`
- 点击 `ProposalBlock` 内"前往审批 Diff" -> 调用 `onViewDiff` 回调 -> shell 调 `InspectorRouter.transition('approval', csId)`
- proposal 卡片显示的 op 描述需要 novel 域实体 label -> shell 顶层 effect 把 novel overview 注入 conversation projection 的 card projector

---

### 3.2 `domains/novel/` -- 小说域

**职责**：管理小说的 5 类数据（overview/outline/manuscript/character/location）的查询、缓存、本地视图状态（展开/选中）。提供 4-tab 内容视图所需的全部数据与组件。

#### 3.2.1 目录结构

```
domains/novel/
├─ index.ts
├─ overview/
│  ├─ NovelOverviewStore.ts
│  └─ useNovelWorkspaceOverview.ts
├─ outline/
│  ├─ components/
│  │  ├─ StoryOutlineTree.tsx
│  │  ├─ StoryOutlineTreeRow.tsx
│  │  ├─ StoryOutlineTreeStatus.tsx
│  │  ├─ StoryOutlineTreeLegend.tsx
│  │  └─ OutlineBlockNote.tsx
│  ├─ hooks/
│  │  └─ useStoryOutlineTree.ts
│  ├─ store/
│  │  └─ StoryOutlineTreeStore.ts
│  └─ projection/
│     └─ StoryOutlineTreeProjection.ts
├─ manuscript/
│  ├─ components/
│  │  ├─ ManuscriptChapterList.tsx
│  │  ├─ ManuscriptChapterCard.tsx
│  │  ├─ ManuscriptBlock.tsx
│  │  └─ ManuscriptDraftTag.tsx
│  ├─ hooks/
│  │  ├─ useManuscriptStructure.ts
│  │  └─ useManuscriptBlock.ts
│  └─ store/
│     └─ ManuscriptStructureStore.ts
├─ character/
│  ├─ components/
│  │  ├─ CharacterGrid.tsx
│  │  ├─ CharacterCard.tsx
│  │  └─ CharacterDetailPanel.tsx
│  ├─ hooks/
│  │  ├─ useCharacterList.ts
│  │  └─ useCharacterDetail.ts
│  └─ store/
│     └─ CharacterStore.ts
└─ location/
   ├─ components/
   │  ├─ LocationGrid.tsx
   │  ├─ LocationCard.tsx
   │  └─ LocationDetailPanel.tsx
   ├─ hooks/
   │  ├─ useLocationList.ts
   │  └─ useLocationDetail.ts
   └─ store/
      └─ LocationStore.ts
```

#### 3.2.2 overview/

```ts
export interface NovelOverviewSnapshot {
  readonly phase: "idle" | "loading" | "ready" | "error";
  readonly workspaceId: string | undefined;
  readonly novelId: string | undefined;
  readonly label: string | undefined;
  readonly counts: {
    readonly storyUnitCount: number;
    readonly characterCount: number;
    readonly locationCount: number;
    readonly chapterCount: number;
    readonly manuscriptBlockCount: number;
  };
  readonly error: NovelOverviewError | undefined;
}

export interface NovelOverviewError {
  readonly code: "load-failed" | "workspace-missing";
  readonly message: string;
  readonly retryable: boolean;
}

export class NovelOverviewStore extends ExternalStore<NovelOverviewSnapshot> {
  constructor(deps: { readonly api: NovelApiClient; readonly logger: Logger });
  loadWorkspace(workspaceId: string): Promise<void>;
  invalidate(): void;
  retry(): Promise<void>;
}

export function useNovelWorkspaceOverview(workspaceId: string | undefined): NovelOverviewSnapshot;
```

#### 3.2.3 outline/

##### StoryOutlineTree

```tsx
export interface StoryOutlineTreeProps {
  readonly workspaceId: string;
  readonly selectedUnitId?: string;
  readonly onSelectUnit?: (unitId: string) => void;
  readonly onToggleExpand?: (unitId: string) => void;
}
```

##### StoryOutlineTreeRow

```tsx
export interface StoryOutlineTreeRowProps {
  readonly unit: StoryOutlineTreeNode;
  readonly depth: number;
  readonly expanded: boolean;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly onToggleExpand: () => void;
}

export interface StoryOutlineTreeNode {
  readonly unitId: string;
  readonly label: string;
  readonly scope: "ARC" | "SCENE";
  readonly planM: 1 | 2 | 3; // idea / outlined / ready
  readonly realNode: "pending" | "in-progress" | "completed" | "blocked" | "abandoned";
  readonly blockedReason?: string;
  readonly abandonedReason?: string;
  readonly progress?: { readonly completed: number; readonly total: number };
  readonly children: readonly StoryOutlineTreeNode[];
}
```

##### StoryOutlineTreeStatus

```tsx
export interface StoryOutlineTreeStatusProps {
  readonly planM: 1 | 2 | 3;
  readonly realNode: "pending" | "in-progress" | "completed" | "blocked" | "abandoned";
}
```

渲染：plan-m 用三段进度条（pm-1 一段亮 / pm-2 两段亮 / pm-3 三段亮）；real-node 用圆点（pending 灰 / in-progress 蓝动画 / completed 绿 / blocked 红 / abandoned 灰斜线）。

##### OutlineBlockNote

```tsx
export interface OutlineBlockNoteProps {
  readonly kind: "blocked" | "abandoned";
  readonly reason: string;
}
```

##### StoryOutlineTreeStore

```ts
export interface StoryOutlineTreeSnapshot {
  readonly phase: "idle" | "loading" | "ready" | "error";
  readonly workspaceId: string | undefined;
  readonly tree: readonly StoryOutlineTreeNode[];
  readonly expansionState: ReadonlyMap<string, boolean>;
  readonly selectedUnitId: string | undefined;
  readonly error: NovelDomainError | undefined;
}

export class StoryOutlineTreeStore extends ExternalStore<StoryOutlineTreeSnapshot> {
  constructor(deps: { readonly api: NovelApiClient; readonly logger: Logger });
  loadWorkspace(workspaceId: string): Promise<void>;
  selectUnit(unitId: string | undefined): void;
  toggleExpand(unitId: string): void;
  expandAll(): void;
  collapseAll(): void;
  invalidate(): void;
}

export function useStoryOutlineTree(workspaceId: string | undefined): StoryOutlineTreeSnapshot;
```

##### StoryOutlineTreeProjection

```ts
export const StoryOutlineTreeProjection: {
  build(units: readonly StoryUnit[]): readonly StoryOutlineTreeNode[];
  findPath(tree: readonly StoryOutlineTreeNode[], unitId: string): readonly string[] | undefined;
};
```

#### 3.2.4 manuscript/

##### ManuscriptChapterList

```tsx
export interface ManuscriptChapterListProps {
  readonly workspaceId: string;
  readonly onSelectBlock?: (blockId: string) => void;
  readonly onOpenDraft?: (changeSetId: string) => void;
}
```

##### ManuscriptChapterCard

```tsx
export interface ManuscriptChapterCardProps {
  readonly chapter: ManuscriptChapter;
  readonly isDraft?: boolean;
  readonly onSelectBlock?: (blockId: string) => void;
  readonly onOpenDraft?: (changeSetId: string) => void;
}

export interface ManuscriptChapter {
  readonly chapterId: string;
  readonly title: string;
  readonly revision?: string;
  readonly isDraft?: boolean;
  readonly changeSetId?: string;
  readonly blocks: readonly ManuscriptBlockData[];
}

export interface ManuscriptBlockData {
  readonly blockId: string; // "§3-01-04"
  readonly digest: string; // 短码 "8f3a70"
  readonly isDraft?: boolean;
  readonly text: string;
}
```

##### ManuscriptBlock

```tsx
export interface ManuscriptBlockProps {
  readonly block: ManuscriptBlockData;
  readonly onSelect?: () => void;
  readonly onOpenDraft?: (changeSetId: string) => void;
}
```

##### ManuscriptStructureStore

```ts
export interface ManuscriptStructureSnapshot {
  readonly phase: "idle" | "loading" | "ready" | "error";
  readonly workspaceId: string | undefined;
  readonly chapters: readonly ManuscriptChapter[];
  readonly error: NovelDomainError | undefined;
}

export class ManuscriptStructureStore extends ExternalStore<ManuscriptStructureSnapshot> {
  constructor(deps: { readonly api: NovelApiClient; readonly logger: Logger });
  loadWorkspace(workspaceId: string): Promise<void>;
  invalidate(): void;
}

export function useManuscriptStructure(workspaceId: string | undefined): ManuscriptStructureSnapshot;
export function useManuscriptBlock(workspaceId: string | undefined, blockId: string | undefined): {
  readonly block: ManuscriptBlockData | undefined;
  readonly phase: "idle" | "loading" | "ready" | "error";
};
```

#### 3.2.5 character/

##### CharacterGrid

```tsx
export interface CharacterGridProps {
  readonly workspaceId: string;
  readonly onSelect?: (characterId: string) => void;
}
```

##### CharacterCard

```tsx
export interface CharacterCardProps {
  readonly character: CharacterSummary;
  readonly onSelect?: () => void;
}

export interface CharacterSummary {
  readonly characterId: string;
  readonly avatarText: string; // 首字
  readonly name: string;
  readonly role: string;
  readonly note: string;
  readonly relatedUnits: readonly string[]; // unit labels
}
```

##### CharacterDetailPanel

```tsx
export interface CharacterDetailPanelProps {
  readonly workspaceId: string;
  readonly characterId: string;
  readonly onLocateInContent?: (characterId: string) => void;
}
```

##### CharacterStore

```ts
export interface CharacterSnapshot {
  readonly phase: "idle" | "loading" | "ready" | "error";
  readonly workspaceId: string | undefined;
  readonly characters: readonly CharacterSummary[];
  readonly detailCache: ReadonlyMap<string, CharacterDetail>;
  readonly selectedId: string | undefined;
  readonly error: NovelDomainError | undefined;
}

export interface CharacterDetail {
  readonly characterId: string;
  readonly avatarText: string;
  readonly name: string;
  readonly role: string;
  readonly profile: string; // 完整档案
  readonly version: number;
  readonly relatedUnits: readonly { readonly unitId: string; readonly label: string }[];
}

export class CharacterStore extends ExternalStore<CharacterSnapshot> {
  constructor(deps: { readonly api: NovelApiClient; readonly logger: Logger });
  loadWorkspace(workspaceId: string): Promise<void>;
  loadDetail(characterId: string): Promise<void>;
  selectCharacter(id: string | undefined): void;
  invalidate(): void;
}

export function useCharacterList(workspaceId: string | undefined): CharacterSnapshot;
export function useCharacterDetail(workspaceId: string | undefined, characterId: string | undefined): {
  readonly detail: CharacterDetail | undefined;
  readonly phase: "idle" | "loading" | "ready" | "error";
};
```

#### 3.2.6 location/

结构与 character 对称，含 `locState: "已建档" | "草稿新增"` 字段。

```ts
export interface LocationSummary {
  readonly locationId: string;
  readonly avatarText: string;
  readonly name: string;
  readonly role: string;
  readonly locState: "filed" | "draft-new";
  readonly note: string;
  readonly relatedUnits: readonly string[];
}

export interface LocationDetail {
  readonly locationId: string;
  readonly avatarText: string;
  readonly name: string;
  readonly role: string;
  readonly locState: "filed" | "draft-new";
  readonly profile: string;
  readonly relatedUnits: readonly { readonly unitId: string; readonly label: string }[];
}

export class LocationStore extends ExternalStore<LocationSnapshot> { /* 同 CharacterStore 模式 */ }
```

#### 3.2.7 跨域联动

- outline 选中 unit -> `StoryOutlineTreeStore.selectUnit(id)` -> shell 调 `InspectorRouter.transition('outlineUnit', id)`
- character/location 选中 -> shell 调 `InspectorRouter.transition('entity', {kind, id})`
- 审批通过 -> approval store 通知 novel store `invalidate(scope)`（通过 shell effect）-> 重新加载
- schedule 域订阅 `NovelOverviewStore` 派生 stats

---

### 3.3 `domains/approval/` -- 审批域

> **状态：待定（用户已确认 approval 域后续再确定）。** 本节为参考设计，不作为实施约束；
> Phase 2 轨道 C 延后，待 core approval API 契约定稿后重新评审本节。

**职责**：管理变更集（ChangeSet, CS-XXXX）队列、单个变更集 diff 详情、审批动作（批准/拒绝/请求修改/备注）。串联 conversation proposal 卡片与 inspector diff review。

#### 3.3.1 目录结构

```
domains/approval/
├─ index.ts
├─ components/
│  ├─ ApprovalQueueList.tsx
│  ├─ ApprovalQueueItem.tsx
│  ├─ ApprovalInspector.tsx
│  ├─ ApprovalTabs.tsx
│  ├─ ApprovalChangeSetList.tsx
│  ├─ ApprovalChangeSetPane.tsx
│  ├─ ApprovalIdentity.tsx
│  ├─ ApprovalDiffLegend.tsx
│  ├─ ApprovalDiffSection.tsx
│  ├─ ApprovalDiffRow.tsx
│  ├─ ApprovalDetailFoot.tsx
│  ├─ ApprovalActions.tsx
│  ├─ ApprovalRequestBox.tsx
│  ├─ ApprovalNoteEditor.tsx
│  └─ ApprovalResolvedBanner.tsx
├─ hooks/
│  ├─ useApprovalQueue.ts
│  ├─ useApprovalChangeSet.ts
│  └─ useApprovalActions.ts
├─ store/
│  ├─ ApprovalQueueStore.ts
│  ├─ ApprovalChangeSetStore.ts
│  └─ ApprovalActionStore.ts
└─ projection/
   └─ ApprovalChangeSetProjection.ts
```

#### 3.3.2 组件

##### ApprovalQueueList

```tsx
export interface ApprovalQueueListProps {
  readonly workspaceId: string;
  readonly onSelect?: (changeSetId: string) => void;
  readonly emptyText?: string;
}
```

##### ApprovalQueueItem

```tsx
export interface ApprovalQueueItemProps {
  readonly changeSet: ApprovalQueueItemData;
  readonly active: boolean;
  readonly onSelect?: () => void;
}

export interface ApprovalQueueItemData {
  readonly changeSetId: string; // "CS-20260805-01"
  readonly title: string;
  readonly meta: string; // "4 处变更 · 旧船坞 7 号场景"
  readonly status: "pending" | "approved" | "changed" | "info";
}
```

##### ApprovalInspector

```tsx
export interface ApprovalInspectorProps {
  readonly workspaceId: string;
  readonly initialTab?: "queue" | "detail";
}
```

容器：含 `ApprovalTabs` + 内容区（`ApprovalChangeSetList` 或 `ApprovalChangeSetPane`）。

##### ApprovalChangeSetPane

```tsx
export interface ApprovalChangeSetPaneProps {
  readonly workspaceId: string;
  readonly changeSetId: string;
  readonly onClose?: () => void;
}
```

##### ApprovalIdentity

```tsx
export interface ApprovalIdentityProps {
  readonly identity: ApprovalIdentityData;
}

export interface ApprovalIdentityData {
  readonly changeSetId: string;
  readonly scope: "manuscript" | "outline" | "character" | "location" | "mixed";
  readonly revisionFrom?: string; // "r041"
  readonly revisionTo?: string; // "r042"
  readonly status: "pending" | "approved" | "rejected" | "requested";
  readonly createdAt: number;
}
```

##### ApprovalDiffSection

```tsx
export interface ApprovalDiffSectionProps {
  readonly title: string; // "大纲" / "正文" / "角色"
  readonly rows: readonly ApprovalDiffRowData[];
}

export interface ApprovalDiffRowData {
  readonly id: string;
  readonly mark: "add" | "mod" | "del" | "move";
  readonly summary: string;
  readonly oldNew?: { readonly old: string; readonly new: string }; // 仅 mod
  readonly details?: readonly string[];
}
```

##### ApprovalDiffRow

```tsx
export interface ApprovalDiffRowProps {
  readonly row: ApprovalDiffRowData;
}
```

##### ApprovalActions

```tsx
export interface ApprovalActionsProps {
  readonly changeSetId: string;
  readonly phase: "idle" | "submitting" | "done" | "error";
  readonly onApprove: () => void;
  readonly onReject: () => void;
  readonly onRequestModification: (note: string) => void;
}
```

##### ApprovalRequestBox

```tsx
export interface ApprovalRequestBoxProps {
  readonly onSubmit: (note: string) => void;
  readonly onCancel: () => void;
}
```

##### ApprovalNoteEditor

```tsx
export interface ApprovalNoteEditorProps {
  readonly changeSetId: string;
  readonly notes: readonly ApprovalNote[];
  readonly onAddNote?: (text: string) => void;
}

export interface ApprovalNote {
  readonly id: string;
  readonly text: string;
  readonly author: string;
  readonly createdAt: number;
}
```

##### ApprovalResolvedBanner

```tsx
export interface ApprovalResolvedBannerProps {
  readonly revision: string; // "r041"
  readonly message?: string;
}
```

#### 3.3.3 hooks

```ts
export function useApprovalQueue(workspaceId: string | undefined): {
  readonly snapshot: ApprovalQueueSnapshot;
  readonly refresh: () => Promise<void>;
};

export function useApprovalChangeSet(workspaceId: string | undefined, changeSetId: string | undefined): {
  readonly snapshot: ApprovalChangeSetSnapshot | undefined;
  readonly refresh: () => Promise<void>;
};

export function useApprovalActions(workspaceId: string, changeSetId: string): {
  readonly phase: "idle" | "submitting" | "done" | "error";
  readonly error: string | undefined;
  readonly approve: () => Promise<void>;
  readonly reject: () => Promise<void>;
  readonly requestModification: (note: string) => Promise<void>;
};
```

#### 3.3.4 store

##### ApprovalQueueStore

```ts
export interface ApprovalQueueSnapshot {
  readonly phase: "idle" | "loading" | "ready" | "error";
  readonly workspaceId: string | undefined;
  readonly queue: readonly ApprovalQueueItemData[];
  readonly error: ApprovalDomainError | undefined;
}

export class ApprovalQueueStore extends ExternalStore<ApprovalQueueSnapshot> {
  constructor(deps: { readonly api: NovelApiClient; readonly logger: Logger });
  loadWorkspace(workspaceId: string): Promise<void>;
  remove(changeSetId: string): void;
  updateStatus(changeSetId: string, status: ApprovalQueueItemData["status"]): void;
  invalidate(): void;
}
```

##### ApprovalChangeSetStore

```ts
export interface ApprovalChangeSetSnapshot {
  readonly changeSetId: string;
  readonly phase: "idle" | "loading" | "ready" | "error";
  readonly identity: ApprovalIdentityData | undefined;
  readonly diffSections: readonly ApprovalDiffSectionData[];
  readonly notes: readonly ApprovalNote[];
  readonly resolved: boolean;
  readonly resolvedRevision?: string;
  readonly error: ApprovalDomainError | undefined;
}

export interface ApprovalDiffSectionData {
  readonly title: string;
  readonly rows: readonly ApprovalDiffRowData[];
}

export class ApprovalChangeSetStore extends ExternalStore<ApprovalChangeSetSnapshot> {
  constructor(deps: { readonly api: NovelApiClient; readonly logger: Logger });
  load(workspaceId: string, changeSetId: string): Promise<void>;
  addNote(note: ApprovalNote): void;
  markResolved(changeSetId: string, revision: string): void;
  invalidate(changeSetId: string): void;
}

export class ApprovalActionStore extends ExternalStore<{
  readonly phases: ReadonlyMap<string, "idle" | "submitting" | "done" | "error">;
  readonly errors: ReadonlyMap<string, string>;
}> {
  submit(workspaceId: string, changeSetId: string, action: "approve" | "reject" | "request", note?: string): Promise<void>;
  getPhase(changeSetId: string): "idle" | "submitting" | "done" | "error";
}
```

#### 3.3.5 projection

```ts
export const ApprovalChangeSetProjection: {
  derive(raw: RawChangeSet): ApprovalChangeSetSnapshot;
  groupDiffSections(raw: RawChangeSet): readonly ApprovalDiffSectionData[];
};
```

#### 3.3.6 跨域联动

- conversation `ProposalBlock` 点击"前往审批" -> shell 调 `InspectorRouter.transition('approval', csId)`
- approval 动作完成 -> shell effect 触发：novel store `invalidate(scope)` + conversation store 重新投影 + approval queue store `remove`/`updateStatus`
- schedule 域订阅 `ApprovalQueueStore` 派生"待审 todo"项

---

### 3.4 `domains/workspace/` -- 工作区域

**职责**：管理当前激活 workspace、recent 列表、选择/关闭流程、workspace 元信息展示。是其他所有域的"上下文根"。

#### 3.4.1 目录结构

```
domains/workspace/
├─ index.ts
├─ components/
│  ├─ WorkspaceFooting.tsx
│  ├─ WorkspaceLabel.tsx
│  ├─ WorkspaceRevisionMeta.tsx
│  ├─ WorkspaceSelectionDialog.tsx   # 已存在
│  └─ WorkspaceEmptyState.tsx        # 已存在
├─ hooks/
│  └─ useWorkspaceControllerSnapshot.ts
├─ store/
│  ├─ WorkspaceController.ts         # 已存在，重构 extends ExternalStore
│  └─ WorkspaceMetadataStore.ts
└─ controller/
   └─ WorkspaceControllerAdapter.ts  # 适配已存在 WorkspaceController 到 ExternalStore
```

#### 3.4.2 组件

##### WorkspaceFooting

```tsx
export interface WorkspaceFootingProps {
  readonly workspaceId: string;
  readonly label: string;
  readonly meta: string; // "r041 · 最后提交 14:02"
  readonly onClick?: () => void;
}
```

##### WorkspaceLabel

```tsx
export interface WorkspaceLabelProps {
  readonly label: string;
  readonly collapsed?: boolean;
  readonly onClick?: () => void;
}
```

##### WorkspaceRevisionMeta

```tsx
export interface WorkspaceRevisionMetaProps {
  readonly revision: string;
  readonly lastCommitAt?: number;
}
```

#### 3.4.3 store

```ts
export interface WorkspaceMetadataSnapshot {
  readonly phase: "idle" | "loading" | "ready" | "error";
  readonly workspaceId: string | undefined;
  readonly novelId: string | undefined;
  readonly label: string | undefined;
  readonly revision: string | undefined;
  readonly lastCommitAt: number | undefined;
  readonly error: WorkspaceError | undefined;
}

export class WorkspaceMetadataStore extends ExternalStore<WorkspaceMetadataSnapshot> {
  constructor(deps: { readonly api: NovelApiClient; readonly logger: Logger });
  loadWorkspace(workspaceId: string): Promise<void>;
  invalidate(): void;
}
```

`WorkspaceController` 已存在；通过 `WorkspaceControllerAdapter` 适配到 `ExternalStore` 接口。

#### 3.4.4 跨域联动

- `WorkspaceController` active 变化 -> shell 顶层 effect 触发所有域 store `loadWorkspace(newId)`
- `WorkspaceMetadataStore` 提供数据给 topbar 的 `WorkspaceLabel` + `WorkspaceRevisionMeta`

---

### 3.5 `domains/schedule/` -- 计划域

**职责**：聚合 novel + approval + conversation 数据，产出"今日该做什么"的视图。**不持有独立数据源**，只做派生。

#### 3.5.1 目录结构

```
domains/schedule/
├─ index.ts
├─ components/
│  ├─ ScheduleStatRow.tsx
│  ├─ ScheduleStat.tsx
│  ├─ ScheduleAxisFlow.tsx
│  ├─ ScheduleProgressCard.tsx
│  ├─ ScheduleTodoList.tsx
│  ├─ ScheduleTodoItem.tsx
│  ├─ ScheduleProgressTree.tsx
│  ├─ ScheduleProgressUnit.tsx
│  └─ ScheduleAbandonedNote.tsx
├─ hooks/
│  ├─ useScheduleOverview.ts
│  ├─ useScheduleTodos.ts
│  └─ useScheduleProgress.ts
├─ store/
│  ├─ ScheduleStore.ts
│  └─ ScheduleTodoStore.ts
└─ projection/
   └─ ScheduleProjection.ts
```

#### 3.5.2 组件

##### ScheduleStatRow

```tsx
export interface ScheduleStatRowProps {
  readonly stats: readonly ScheduleStatData[];
}

export interface ScheduleStatData {
  readonly id: string;
  readonly num: number;
  readonly label: string;
  readonly note: string;
  readonly variant?: "default" | "danger" | "warn";
}
```

##### ScheduleAxisFlow

```tsx
export interface ScheduleAxisFlowProps {
  readonly planAxis: readonly string[]; // ["idea", "outlined", "ready"]
  readonly realAxis: readonly string[]; // ["pending", "in-progress", "completed", "abandoned"]
}
```

##### ScheduleTodoItem

```tsx
export interface ScheduleTodoItemProps {
  readonly todo: ScheduleTodoData;
  readonly onToggle?: () => void;
  readonly onAction?: (action: string) => void; // "去审批" 等
}

export interface ScheduleTodoData {
  readonly id: string;
  readonly title: string;
  readonly meta: string; // "阻塞 追踪错误目标 · 截止今天 18:00"
  readonly tag: "decision" | "approval" | "profile" | "writing";
  readonly status: "open" | "done";
  readonly action?: { readonly label: string; readonly kind: "open-approval" | "open-character" | "open-location" };
}
```

##### ScheduleProgressUnit

```tsx
export interface ScheduleProgressUnitProps {
  readonly unit: ScheduleProgressUnitData;
}

export interface ScheduleProgressUnitData {
  readonly unitId: string;
  readonly label: string;
  readonly depth: number;
  readonly planM: 1 | 2 | 3;
  readonly realNode: "pending" | "in-progress" | "completed" | "blocked" | "abandoned";
  readonly progress?: { readonly completed: number; readonly total: number };
  readonly blockedReason?: string;
  readonly abandonedReason?: string;
}
```

#### 3.5.3 hooks

```ts
export function useScheduleOverview(workspaceId: string | undefined): {
  readonly stats: readonly ScheduleStatData[];
  readonly axisFlow: { readonly planAxis: readonly string[]; readonly realAxis: readonly string[] };
  readonly phase: "idle" | "loading" | "ready" | "error";
};

export function useScheduleTodos(workspaceId: string | undefined): {
  readonly todos: readonly ScheduleTodoData[];
  readonly onToggle: (id: string) => void;
};

export function useScheduleProgress(workspaceId: string | undefined): {
  readonly tree: readonly ScheduleProgressUnitData[];
  readonly phase: "idle" | "loading" | "ready" | "error";
};
```

#### 3.5.4 store

```ts
export interface ScheduleSnapshot {
  readonly phase: "idle" | "loading" | "ready" | "error";
  readonly workspaceId: string | undefined;
  readonly stats: readonly ScheduleStatData[];
  readonly axisFlow: { readonly planAxis: readonly string[]; readonly realAxis: readonly string[] };
  readonly todos: readonly ScheduleTodoData[];
  readonly progressTree: readonly ScheduleProgressUnitData[];
}

/**
 * 派生 store。订阅 NovelOverviewStore + ApprovalQueueStore + ConversationCatalogStore。
 * 不直接发 core API 请求。
 */
export class ScheduleStore extends ExternalStore<ScheduleSnapshot> {
  constructor(deps: {
    readonly novelOverview: NovelOverviewStore;
    readonly approvalQueue: ApprovalQueueStore;
    readonly conversationCatalog: ConversationCatalogStore;
    readonly outlineTree: StoryOutlineTreeStore;
    readonly logger: Logger;
  });
  recompute(): void;
}

export class ScheduleTodoStore extends ExternalStore<{
  readonly todoState: ReadonlyMap<string, "open" | "done">;
}> {
  toggle(id: string): void;
}
```

#### 3.5.5 projection

```ts
export const ScheduleProjection: {
  deriveStats(overview: NovelOverviewSnapshot, outline: StoryOutlineTreeSnapshot): readonly ScheduleStatData[];
  deriveTodos(approval: ApprovalQueueSnapshot, novel: NovelOverviewSnapshot, conversation: ConversationCatalogSnapshot): readonly ScheduleTodoData[];
  deriveProgressTree(outline: StoryOutlineTreeSnapshot): readonly ScheduleProgressUnitData[];
};
```

#### 3.5.6 跨域联动

- 仅订阅其他域 store，不发起 core API 调用
- 点击 `ScheduleTodoItem` 中"去审批" -> 调 `onAction("open-approval")` -> shell 调 `InspectorRouter.transition('approval', csId)` + `MainViewRouter.transition('chat')`

---

## 4. Shell 组合层（shell/）

**职责**：把 5 个域拼装成可见表面。Shell 不持有业务状态，只做"路由 + 组合 + 协调副作用"。

### 4.1 `shell/ApplicationShell.tsx`

```tsx
export interface ApplicationShellProps {
  readonly mainViewRouter: MainViewRouter;
  readonly inspectorRouter: InspectorRouter;
  readonly shellStore: ApplicationShellStore;
  readonly workspaceController: WorkspaceController;
  readonly domainStores: {
    readonly conversationCatalog: ConversationCatalogStore;
    readonly novelOverview: NovelOverviewStore;
    readonly storyOutlineTree: StoryOutlineTreeStore;
    readonly manuscriptStructure: ManuscriptStructureStore;
    readonly character: CharacterStore;
    readonly location: LocationStore;
    readonly approvalQueue: ApprovalQueueStore;
    readonly approvalChangeSet: ApprovalChangeSetStore;
    readonly approvalAction: ApprovalActionStore;
    readonly workspaceMetadata: WorkspaceMetadataStore;
    readonly schedule: ScheduleStore;
    readonly scheduleTodo: ScheduleTodoStore;
  };
  readonly inspectorRenderers?: InspectorRendererRegistry;
  readonly conversationCardRenderers?: ConversationCardRendererRegistry;
  readonly conversationCardProjectors?: ConversationCardProjectorRegistry;
  readonly settingsStore: ApplicationSettingsStore;
  readonly configurationClient?: ApplicationConfigurationClient;
  readonly commandSource?: ApplicationCommandSource;
  readonly extensions: NovelUiExtensions;
}
```

**DOM 结构**：

```html
<div class="novel-shell">
  <TopBar />
  <div class="novel-shell-body" data-sidebar-mode data-inspector-mode>
    <Sidebar />
    <MainArea />
    <InspectorHost />
  </div>
  <OverlaysHost />
</div>
```

**关键 effect**：

```tsx
// workspace 切换时触发各域 load
useEffect(() => {
  const workspaceId = workspaceSnapshot.current?.id;
  if (!workspaceId) return;
  void conversationCatalog.loadWorkspace(workspaceId);
  void novelOverview.loadWorkspace(workspaceId);
  void storyOutlineTree.loadWorkspace(workspaceId);
  void manuscriptStructure.loadWorkspace(workspaceId);
  void character.loadWorkspace(workspaceId);
  void location.loadWorkspace(workspaceId);
  void approvalQueue.loadWorkspace(workspaceId);
  void workspaceMetadata.loadWorkspace(workspaceId);
}, [workspaceSnapshot.current?.id]);
```

### 4.2 `shell/topbar/`

| 组件 | 作用 |
|---|---|
| `TopBar` | 容器；左侧 workspace 标识 + 中间 view switcher + 右侧 actions；含 backdrop-filter 模糊 |
| `TopBarWorkspaceLabel` | 显示 `WorkspaceLabel`（workspace 域）+ 展开/折叠状态 |
| `TopBarRevisionMeta` | 显示 `WorkspaceRevisionMeta`（workspace 域） |
| `TopBarViewSwitcher` | 三段式切换器：对话/内容/计划；订阅 `MainViewRouter` |
| `TopBarAction` | 通用 action 按钮：图标 + 文字 + 可选 badge |
| `TopBarMenuSlot` | 接收 `extensions.titleBar` 注入的菜单项 |

```tsx
export interface TopBarProps {
  readonly mainViewRouter: MainViewRouter;
  readonly workspaceController: WorkspaceController;
  readonly workspaceMetadata: WorkspaceMetadataStore;
  readonly approvalQueue: ApprovalQueueStore;
  readonly onOpenSettings: () => void;
  readonly onOpenWorkspace: () => void;
  readonly onToggleSidebar: () => void;
  readonly sidebarMode: "expanded" | "collapsed";
}
```

### 4.3 `shell/sidebar/`

| 组件 | 作用 |
|---|---|
| `Sidebar` | 容器；含折叠动画 |
| `SidebarSection` | 通用 section：label + count-pill + children |
| `SidebarToggleButton` | 折叠/展开按钮 |
| `sections/NewConversationSection` | 引用 conversation `NewConversationButton` |
| `sections/ConversationListSection` | 引用 conversation `ConversationList` |
| `sections/ApprovalQueueSection` | 引用 approval `ApprovalQueueList` |
| `sections/TodoSection` | 引用 schedule `ScheduleTodoList`（紧凑版） |
| `sections/WorkspaceFootingSection` | 引用 workspace `WorkspaceFooting` |

```tsx
export interface SidebarProps {
  readonly mode: "expanded" | "collapsed";
  readonly onToggle: () => void;
  readonly conversationCatalog: ConversationCatalogStore;
  readonly approvalQueue: ApprovalQueueStore;
  readonly scheduleTodo: ScheduleTodoStore;
  readonly workspaceController: WorkspaceController;
  readonly workspaceMetadata: WorkspaceMetadataStore;
  readonly inspectorRouter: InspectorRouter;
}
```

Section 排序：固定顺序 新建 -> 对话 -> 审批 -> 待办 -> (auto-fill) -> footing；footing 始终贴底。

### 4.4 `shell/main/`

| 组件 | 作用 |
|---|---|
| `MainArea` | 路由 host；订阅 `MainViewRouter`；带 `view-in` 动画 |
| `MainViewRouter` | 状态机（见 shared/routing） |
| `ChatSurface` | 组合 conversation：`ConversationTimeline` + `ConversationComposer` + `ChatEmptyState` |
| `ContentSurface` | 含 `ContentTabs`（outline/manuscript/characters/locations）+ 当前 tab 内容 |
| `ContentTabs` | 四 tab 切换条；本地 state（不进 MainViewRouter） |
| `ScheduleSurface` | 组合 schedule：`ScheduleStatRow` + `ScheduleAxisFlow` + `ScheduleProgressCard` |
| `MainSubHead` | 子头部：标题 + sub + 返回按钮 + 视图级 action |

```tsx
export interface MainAreaProps {
  readonly mainViewRouter: MainViewRouter;
  readonly inspectorRouter: InspectorRouter;
  readonly domainStores: ApplicationShellProps["domainStores"];
  readonly conversationCardRenderers?: ConversationCardRendererRegistry;
  readonly conversationCardProjectors?: ConversationCardProjectorRegistry;
}
```

**ChatSurface 内部组合**：

```tsx
function ChatSurface({ workspaceId, conversationCatalog, ... }) {
  const catalog = useExternalStore(conversationCatalog);
  const activeId = catalog.activeConversationId;
  if (!activeId) return <ChatEmptyState />;
  return (
    <>
      <MainSubHead title={...} />
      <ConversationTimeline conversationId={activeId} ... />
      <ConversationComposer conversationId={activeId} ... />
    </>
  );
}
```

### 4.5 `shell/inspector/`

| 组件 | 作用 |
|---|---|
| `InspectorHost` | 容器；含 `DragHandle` 拖拽调宽；订阅 `InspectorRouter` |
| `InspectorRouter` | 状态机（见 shared/routing） |
| `InspectorTabs` | 顶部 tab 条；按当前 panel 类型动态显示 |
| `panels/ApprovalInspectorPanel` | 引用 approval `ApprovalInspector` |
| `panels/EntityInspectorPanel` | 引用 novel `CharacterDetailPanel` 或 `LocationDetailPanel` |
| `panels/OutlineUnitInspectorPanel` | 引用 novel outline unit 详情 |
| `panels/ConversationInspectorPanel` | 引用 conversation 元信息 |

```tsx
export interface InspectorHostProps {
  readonly inspectorRouter: InspectorRouter;
  readonly domainStores: ApplicationShellProps["domainStores"];
  readonly width: number;
  readonly onResize: (width: number) => void;
  readonly renderers?: InspectorRendererRegistry;
}
```

宽度策略：默认 360px；拖拽范围 [280, 560]；`wide` mode = 480px（由 card `inspectorSize` 触发）；持久化到 `ApplicationSettingsStore`。

### 4.6 `shell/overlays/`

| 组件 | 作用 |
|---|---|
| `OverlaysHost` | 容器；z-index 50；管理多个 overlay 栈顺序 |
| `SettingsDialog` | 已存在；设置弹窗 |
| `WorkspaceSelectionDialog` | 已存在；Workspace 选择弹窗 |
| `ToastHost` | 全局 toast；订阅 `ToastStore`；右下角堆叠；auto-dismiss 4s |
| `CommandPalette` | （可选）命令面板；Ctrl+Shift+P 触发 |

```tsx
export interface OverlaysHostProps {
  readonly settingsOpen: boolean;
  readonly workspaceDialogOpen: boolean;
  readonly onDismissSettings: () => void;
  readonly onDismissWorkspaceDialog: () => void;
  readonly settingsStore: ApplicationSettingsStore;
  readonly configurationClient?: ApplicationConfigurationClient;
  readonly workspaceController: WorkspaceController;
  readonly extensions: NovelUiExtensions;
  readonly toastStore: ToastStore;
}
```

**ToastStore**（位于 `shared/state/`）：

```ts
export interface Toast {
  readonly id: string;
  readonly kind: "info" | "success" | "warn" | "danger";
  readonly text: string;
  readonly createdAt: number;
}

export class ToastStore extends ExternalStore<{ readonly toasts: readonly Toast[] }> {
  push(toast: Omit<Toast, "id" | "createdAt">): string;
  dismiss(id: string): void;
}
```

---

## 5. GUI Renderer 组合（@novel/gui/src/renderer/）

### 5.1 目录结构

```
gui/src/renderer/
├─ DesktopNovelApp.tsx              # 组合根
├─ DesktopRendererBootstrap.tsx     # ReactDOM 挂载入口
├─ ElectronFrontendPlatform.ts      # FrontendPlatform 实现
├─ ElectronWorkspaceController.ts   # 已存在
├─ ElectronApplicationCommandSource.ts # 已存在
├─ ElectronApplicationConfigurationClient.ts # 已存在
├─ ElectronPreloadBridgeResolver.ts # 已存在
├─ transport/
│  └─ ElectronApiTransport.ts       # 已存在
├─ extensions/
│  ├─ createDesktopUiExtensions.tsx
│  ├─ DesktopTitleBar.tsx
│  ├─ DesktopRoutes.tsx
│  ├─ DesktopCommands.ts
│  └─ DesktopSettingsSections.tsx
├─ features/                        # 桌面专属 UI
│  ├─ local-runtime/
│  ├─ native-file-browser/
│  ├─ system-tray/
│  ├─ application-update/
│  └─ desktop-settings/
├─ platform/                        # 桌面专属 port 实现
│  ├─ DesktopWindowPort.ts
│  ├─ DesktopUpdaterPort.ts
│  ├─ DesktopSystemTrayPort.ts
│  └─ DesktopNativeFilePort.ts
└─ renderer.css
```

### 5.2 组合根（DesktopNovelApp.tsx）

```tsx
export function DesktopNovelApp() {
  const bridge = useElectronPreloadBridge();
  const transport = useMemo(() => new ElectronApiTransport(bridge), [bridge]);
  const api = useMemo(() => new DefaultNovelApiClient(transport), [transport]);
  const platform = useMemo(() => new ElectronFrontendPlatform(bridge), [bridge]);
  const extensions = useMemo(() => createDesktopUiExtensions(), []);
  const logger = useMemo(() => createDesktopLogger(), []);

  return (
    <NovelApp
      api={api}
      platform={platform}
      extensions={extensions}
      logger={logger}
    />
  );
}
```

### 5.3 与 Main/Preload 集成点

| 跨越边界 | 内容 | 拥有方 |
|---|---|---|
| Renderer -> Preload | `NovelDesktopApi` 接口（transport 调用 + platform port 调用） | Preload 暴露，Renderer 消费 |
| Preload -> Main | IPC channel 调用 | Preload 发起，Main 处理 |
| Main -> Renderer | 事件推送 | Main 发起，Preload 转发，Renderer 订阅 |

**安全约束**（已存在，保留）：
- Renderer contextIsolation: true, sandbox: true
- Preload 仅暴露白名单 API，不含 `ipcRenderer.on` 透传
- Main 验证 sender WebContents 归属，拒绝跨窗口 IPC
- Renderer 永远不直接 `require('electron')` 或访问 Node API

### 5.4 桌面专属能力

| Port | 方法 | 实现 |
|---|---|---|
| `DesktopWindowPort` | minimize / maximize / close / setAlwaysOnTop / setFullscreen | IPC to Main |
| `DesktopUpdaterPort` | checkForUpdates / downloadUpdate / quitAndInstall | IPC to Main |
| `DesktopSystemTrayPort` | setTrayIcon / setTrayMenu / showTrayNotification | IPC to Main |
| `DesktopNativeFilePort` | selectFile / selectDirectory / previewFile | IPC to Main |

通过 `DesktopPlatformApi` 接口注入到 `extensions.features/` 内桌面专属组件；shared 层永远不引用它们。

---

## 6. 视觉设计系统

### 6.1 Design Tokens 完整定义

见 `2.1.1 tokens.css`。

### 6.2 视觉语言约定

- **表面叠加**：透明度通过 `color-mix(in oklab, var(--surface) 82%, transparent)` 实现，不直接写 rgba
- **状态色配对**：每个状态色有 `--color-X` 与 `--color-X-bg` 配对；pill/badge 使用 bg 变体作为背景、X 作为前景
- **边框层级**：默认 `--color-border`；hover/active 升级到 `--color-border-strong`；focus 使用 `--color-accent` 50% 混合
- **字体梯度**：display 19px/800、sub-head 16px/800、body 13.5px/650、meta 11.5px/650、mono 11px/700 letter-spacing 0.1em
- **动画**：所有动画使用 `var(--duration-base) var(--ease-out)`；`prefers-reduced-motion` 全局禁用

### 6.3 Dark Mode 策略

V1 仅 light mode。tokens 结构支持未来 dark：

```css
:root { --color-bg: oklch(97.9% 0.003 85); ... }
[data-theme="dark"] { --color-bg: oklch(20% 0.005 60); ... }
```

组件只引用令牌，不写死颜色。V2 实现时只需添加 dark 令牌覆盖。

### 6.4 CSS Modules 约定

- 每个组件配套 `ComponentName.module.css`
- 类名 camelCase（`topBar`、`viewSwitcher`、`active`）
- 通过 `import styles from "./Component.module.css"` + `className={styles.topBar}` 引用
- 共享动画从 `shared/theme/animations.css` import（全局类）
- 设计令牌从 `tokens.css` 直接引用（全局变量，无需 import）

### 6.5 关键组件视觉规范

| 组件 | 关键样式 |
|---|---|
| TopBar | 高 56px；backdrop-filter blur(16px)；border-bottom 1px var(--border) |
| Sidebar | 宽 292px；backdrop-filter blur(16px)；border-right 1px var(--border) |
| SubHead | 高 58px；backdrop-filter blur(14px)；border-bottom 1px var(--border) |
| InspectorHost | 默认宽 360px；border-left 1px var(--border)；含 DragHandle |
| SideItem | padding 8px 10px；radius 9px；hover bg var(--surface-2)；active bg accent 9% mix |
| ConvItem | padding 8px 10px；radius 9px；active 同上 |
| ApprovalQueueItem | border 1px var(--border)；radius 10px；padding 9px 10px；active border accent 55% mix |
| Pill | padding 2px 7px；radius pill；font 10.5px bold；letter-spacing 0.03em |
| Avatar | 34x34；radius 10px；display grid place-items center；font 12px bold |
| ManuscriptBlock | b-head 11.5px mono；p 13.5px body；padding 8px 0 |

---

## 7. 状态管理策略

### 7.1 ExternalStore 约定

见 `2.4.1`。所有域 store 必须继承 `ExternalStore`；快照 immutable；mutation 通过 `setSnapshot` 自动 freeze + notify。

### 7.2 异步与并发

- **TaskSerializer**：workspace 切换、conversation create/open、approval action 等可能并发的操作必须经 TaskSerializer 串行
- **加载 phase**：每个 store 的快照含 `phase: 'idle' | 'loading' | 'ready' | 'error'`；UI 按 phase 渲染 loading/error 态
- **取消**：长操作（流式订阅、审批提交）支持 `AbortSignal`；store 在 `dispose()` 时 abort 所有进行中操作
- **重试**：失败 phase 含 `retryable: boolean`；UI 显式 retry 按钮触发 `store.retry()`

### 7.3 派生 store（schedule 域）

```ts
class ScheduleStore extends ExternalStore<ScheduleSnapshot> {
  constructor(deps: { readonly novelOverview: NovelOverviewStore; ... }) {
    super(initialSnapshot);
    this.novelOverview = deps.novelOverview;
    novelOverview.subscribe(this.recompute);
    deps.approvalQueue.subscribe(this.recompute);
    deps.conversationCatalog.subscribe(this.recompute);
    deps.outlineTree.subscribe(this.recompute);
    this.recompute();
  }

  private recompute = (): void => {
    const next = ScheduleProjection.derive(
      this.novelOverview.getSnapshot(),
      this.approvalQueue.getSnapshot(),
      this.conversationCatalog.getSnapshot(),
      this.outlineTree.getSnapshot(),
    );
    if (ImmutableSnapshot.deepEqual(next, this.snapshot)) return;
    this.setSnapshot(next);
  };
}
```

### 7.4 跨域协调（shell 层 effect）

见 `4.1` ApplicationShell 的 workspace 切换 effect。shell 是唯一允许跨域触发副作用的地方。

### 7.5 快照不可变性与相等比较

- 所有快照 `Object.freeze` 深度冻结
- `useSyncExternalStore` 默认 `Object.is` 比较；冻结快照保证引用稳定
- 派生 store 重新计算时，若 `ImmutableSnapshot.deepEqual(next, prev)` 则复用上一引用（避免无谓重渲染）

### 7.6 错误处理

每个 store 快照含 `error` 字段：

```ts
interface DomainError {
  readonly code: string; // "load-failed" | "create-failed" | "network" | ...
  readonly message: string; // 用户可见文案（已脱敏）
  readonly retryable: boolean;
}
```

错误不暴露 raw error 对象、stack、内部路径、Event payload、credential；只暴露稳定 code + 用户文案。

---

## 8. 测试策略

### 8.1 单元测试

| 层 | 测试内容 | 工具 |
|---|---|---|
| store | subscribe/notify 行为、快照不可变性、load/error phase、并发串行 | vitest + 内存 mock api |
| projection | 输入 events -> 期望输出状态；reducer 纯函数测试 | vitest |
| hook | subscribe、snapshot、unmount cleanup | @testing-library/react + ScriptedApiTransport |

每个 store 至少 3-5 个测试：初始状态、loadWorkspace 成功、loadWorkspace 失败、mutation 串行、retry。

### 8.2 组件测试

每个组件至少 1 个渲染测试 + 1-2 个交互测试：

```tsx
describe("ConversationTimeline", () => {
  it("renders messages in sequence order", () => { ... });
  it("auto-scrolls to bottom on new message", () => { ... });
  it("invokes onMessageReferenceClick when chip clicked", () => { ... });
});
```

### 8.3 契约测试

`ScriptedApiTransport`（已存在）模拟 core API 响应；每个域 store 测试与 core API 的契约。

```ts
describe("ConversationCatalogStore contract", () => {
  it("calls api.conversations.list on loadWorkspace", async () => { ... });
  it("handles list error with stable code", async () => { ... });
  it("creates conversation via api.conversations.create", async () => { ... });
});
```

cross-transport 测试：同一 store 通过 Electron-shaped 与 HTTP-shaped transport 行为一致。

### 8.4 视觉冒烟（Electron）

Playwright + Electron 跑端到端 7-step 流程：

1. 启动 `pnpm gui` -> 截图 empty state
2. 打开测试 workspace -> 截图 overview
3. 新建对话 -> 发消息 -> 等待流式响应 -> 截图 timeline
4. 点击 proposal -> 验证 inspector 跳转 approval
5. 切换 content view -> 验证 outline tree 渲染
6. 切换 schedule view -> 验证 stats 渲染
7. 打开 settings -> 修改 provider -> 验证持久化

### 8.5 测试矩阵

| 测试类型 | 每个域至少 | 每个组件至少 | shell 层 | 整体 |
|---|---|---|---|---|
| 单元 | 3-5 个 store 测试 | - | - | - |
| 组件 | - | 1 个渲染 + 1-2 个交互 | - | - |
| 契约 | 1 个 ScriptedApiTransport 测试 | - | - | - |
| 视觉冒烟 | - | - | - | 1 个 7-step 流程 |

### 8.6 测试工具

- vitest：单元 + 组件
- @testing-library/react：组件交互
- ScriptedApiTransport：契约（已存在）
- Playwright + Electron：视觉冒烟
- 截图 diff：视觉回归（PR 时）

---

## 9. 实施顺序

### Phase 1: 共享基础设施（1.5 周）

任务清单：
- [ ] `shared/theme/tokens.css`（完整令牌）
- [ ] `shared/theme/global.css`
- [ ] `shared/theme/animations.css`
- [ ] `shared/theme/ThemeProvider.tsx`
- [ ] `shared/primitives/Button.tsx` + `.module.css`
- [ ] `shared/primitives/IconButton.tsx`
- [ ] `shared/primitives/Dialog.tsx`（Radix）
- [ ] `shared/primitives/Dropdown.tsx`（Radix）
- [ ] `shared/primitives/Tabs.tsx`（Radix）
- [ ] `shared/primitives/Tooltip.tsx`（Radix）
- [ ] `shared/primitives/Separator.tsx`
- [ ] `shared/primitives/DragHandle.tsx`
- [ ] `shared/primitives/Spinner.tsx`
- [ ] `shared/primitives/Badge.tsx`
- [ ] `shared/primitives/Pill.tsx`
- [ ] `shared/primitives/Avatar.tsx`
- [ ] `shared/primitives/Kbd.tsx`
- [ ] `shared/primitives/Text.tsx`
- [ ] `shared/primitives/Icon.tsx`
- [ ] `shared/state/ExternalStore.ts`
- [ ] `shared/state/ImmutableSnapshot.ts`
- [ ] `shared/state/useExternalStore.ts`
- [ ] `shared/state/TaskSerializer.ts`
- [ ] `shared/state/ToastStore.ts`
- [ ] `shared/routing/MainViewRouter.ts`
- [ ] `shared/routing/InspectorRouter.ts`
- [ ] `shared/routing/MainViewHistory.ts`
- [ ] ESLint rule `no-restricted-imports` 配置
- [ ] 单元测试覆盖 ExternalStore、ImmutableSnapshot、TaskSerializer、Routers

**Gate**：所有 primitives 有视觉快照；ExternalStore 单元测试覆盖；ESLint 规则 CI 强制。

### Phase 2: 五个域（3-4 周，可并行）

并行轨道：
- **轨道 A（关键路径）**：workspace -> conversation
- **轨道 B**：novel（5 个 sub-domain 内部串行，但与其他域并行）
- **轨道 C**：approval（⚠️ 已延后待定——approval 域后续再确定；依赖 core approval API 契约定稿）
- **轨道 D（最后）**：schedule（依赖其他域 store 完成）

每域任务清单（以 conversation 为例）：
- [ ] `domains/conversation/store/ConversationCatalogStore.ts`
- [ ] `domains/conversation/store/ComposerDraftStore.ts`（重构已存在）
- [ ] `domains/conversation/projection/*`
- [ ] `domains/conversation/cards/ConversationCardRendererRegistry.ts`
- [ ] `domains/conversation/cards/renderers/*`（6 个 renderer）
- [ ] `domains/conversation/hooks/*`（4 个 hook）
- [ ] `domains/conversation/components/*`（16 个组件 + .module.css）
- [ ] 单元测试：store + projection
- [ ] 组件测试：渲染 + 交互
- [ ] 契约测试：ScriptedApiTransport

**Gate**：每域单元测试 + 契约测试 + 组件渲染测试通过。

### Phase 3: Shell 组合层（2 周）

任务清单：
- [ ] `shell/ApplicationShell.tsx`
- [ ] `shell/topbar/*`（6 个组件）
- [ ] `shell/sidebar/*`（容器 + 5 个 section）
- [ ] `shell/main/*`（MainArea + 3 个 Surface + ContentTabs + MainSubHead）
- [ ] `shell/inspector/*`（InspectorHost + 4 个 panel）
- [ ] `shell/overlays/*`（OverlaysHost + ToastHost + CommandPalette 可选）
- [ ] 跨域 effect 协调
- [ ] 视觉冒烟测试建立

**Gate**：7-step 视觉冒烟全过；与原型的视觉对比 diff < 5%。

### Phase 4: GUI Renderer（1 周）

任务清单：
- [ ] `gui/src/renderer/DesktopNovelApp.tsx`（组合根）
- [ ] `gui/src/renderer/DesktopRendererBootstrap.tsx`
- [ ] `gui/src/renderer/ElectronFrontendPlatform.ts`（完善）
- [ ] `gui/src/renderer/extensions/createDesktopUiExtensions.tsx`
- [ ] `gui/src/renderer/extensions/DesktopTitleBar.tsx`
- [ ] `gui/src/renderer/extensions/DesktopRoutes.tsx`
- [ ] `gui/src/renderer/extensions/DesktopCommands.ts`
- [ ] `gui/src/renderer/extensions/DesktopSettingsSections.tsx`
- [ ] `gui/src/renderer/platform/Desktop*Port.ts`（4 个 port）
- [ ] `gui/src/renderer/features/local-runtime/`（按优先级）
- [ ] `gui/src/renderer/features/desktop-settings/`
- [ ] `gui/src/renderer/features/native-file-browser/`
- [ ] `gui/src/renderer/features/system-tray/`
- [ ] `gui/src/renderer/features/application-update/`
- [ ] Preload 桥接扩展（按需）

**Gate**：`pnpm gui` 启动真实 Electron 窗口，所有 V1 表面可交互。

### Phase 5: 视觉打磨 + a11y + 性能（1-2 周）

任务清单：
- [ ] 视觉细节对齐原型（间距、圆角、动画时长）
- [ ] a11y 审计：键盘导航、焦点陷阱、ARIA 属性、对比度
- [ ] 性能：消息列表虚拟化、inspector 拖拽 rAF 节流、流式渲染批处理
- [ ] 文档：每个域的 README
- [ ] 组件 story（若引入 Storybook）

**Gate**：a11y 审计无 critical；性能基准（首屏 < 2s，消息流式 < 16ms/frame）达标。

---

## 10. 附录

### 10.1 关键 type 定义汇总

```ts
// shared/state
abstract class ExternalStore<S> { /* see 2.4.1 */ }
const ImmutableSnapshot: { freeze<T>(value: T): T; deepEqual<T>(a: T, b: T): boolean };
class TaskSerializer { run<T>(task: () => Promise<T>): Promise<T>; }
class ToastStore extends ExternalStore<{ readonly toasts: readonly Toast[] }> { /* see 4.6 */ }

// shared/routing
type MainViewState = "chat" | "content" | "schedule";
type InspectorState = { kind: "closed" } | { kind: "approval"; changeSetId: string } | ...;
class MainViewRouter extends ExternalStore<MainViewSnapshot> { /* see 2.5.1 */ }
class InspectorRouter extends ExternalStore<InspectorSnapshot> { /* see 2.5.2 */ }

// domains/conversation
interface ConversationCatalogSnapshot { /* see 3.1.4 */ }
interface ConversationTimelineItem { /* see 3.1.5 */ }
type ConversationCardDescriptor = /* see 3.1.5 */;

// domains/novel
interface NovelOverviewSnapshot { /* see 3.2.2 */ }
interface StoryOutlineTreeNode { /* see 3.2.3 */ }
interface ManuscriptChapter { /* see 3.2.4 */ }
interface CharacterSummary { /* see 3.2.5 */ }

// domains/approval
interface ApprovalQueueSnapshot { /* see 3.3.4 */ }
interface ApprovalChangeSetSnapshot { /* see 3.3.4 */ }

// domains/workspace
interface WorkspaceMetadataSnapshot { /* see 3.4.3 */ }

// domains/schedule
interface ScheduleSnapshot { /* see 3.5.4 */ }
```

### 10.2 错误处理约定

所有域 store 快照的 `error` 字段遵循：

```ts
interface DomainError {
  readonly code: string;          // 稳定错误码，用于 i18n 与重试逻辑
  readonly message: string;       // 用户可见文案，已脱敏
  readonly retryable: boolean;
}
```

**禁止暴露**：raw Error 对象、stack trace、内部文件路径、Event payload、prompt 内容、credential、Store/work 路径、JSONL 行、Runtime stderr。

错误码命名：`<domain>-<operation>-<failure>`，如 `conversation-load-failed`、`approval-submit-network`。

### 10.3 边界情况

| 场景 | 处理 |
|---|---|
| Workspace 未选择 | 所有域 store phase=idle；shell 渲染 `WorkspaceEmptyState` |
| Workspace 切换中 | 各域 store 串行 clear+load；shell 显示过渡态 |
| 网络断开 | Transport 层重连；store phase=error + retryable=true；UI 显示 banner |
| 流式中取消 | `AbortSignal` 触发；store 保留已收到的 deltas + phase=cancelled |
| 审批并发提交 | `ApprovalActionStore` 经 TaskSerializer 串行；第二个提交等第一个完成 |
| 派生 store 上游 error | ScheduleStore 检测上游 error phase，自身 phase=error + 复用上游 message |
| Inspector 拖拽越界 | DragHandle 限制在 [min, max]；超出范围 clamp |
| 消息超长 | ConversationTimeline 虚拟化（>200 条）；单条消息 max-height 600px + 内滚动 |

### 10.4 性能基准

| 指标 | 目标 |
|---|---|
| 首屏（empty state） | < 2s |
| Workspace 加载（overview + outline + queue） | < 3s |
| 消息流式渲染 | < 16ms/frame |
| Inspector 拖拽 | < 16ms/frame（rAF 节流） |
| 视图切换 | < 200ms |
| 对话列表 1000 项渲染 | < 500ms（虚拟化） |

### 10.5 命名规范

- 文件：PascalCase for components（`ConversationTimeline.tsx`），camelCase for utilities（`useConversationProjection.ts`）
- 目录：kebab-case（`local-runtime/`）
- CSS Modules：`ComponentName.module.css`，类名 camelCase
- TypeScript types/interfaces：PascalCase，不加 `I` 前缀
- Hooks：`use` 前缀
- Stores：`*Store` 后缀
- Projections：`*Projection` 后缀（namespace object，不是 class）

### 10.6 文件顶部注释规范

每个 `.ts`/`.tsx` 文件顶部必须有 purpose 注释：

```ts
/**
 * ConversationCatalogStore
 *
 * 管理对话列表的域 store。负责从 core API 加载对话列表、跟踪 active 对话、
 * 提供 create/select/rename/delete/pin 操作。所有 mutation 经 TaskSerializer 串行。
 *
 * 不持有对话内消息状态（那是 ConversationProjectionStore 的职责）。
 */
```

### 10.7 日志规范

遵循 AGENTS.md：日志使用 structured `info` / `debug`；**禁止**记录 Event payload、novel 文本、prompt、配置内容、Tool 数据、credential、Store/work 路径、JSONL 行、raw error、stack、cause、Runtime stderr。

允许记录：domain 名、operation 名、phase 变化、duration、稳定的 error code、count。

---

## 11. 后续工作（不在本 spec 范围）

- core 层的 approval API 契约定稿（当前 spec 假设 `api.approval.{list, get, approve, reject, requestModification}` 存在）
- core 层的 workspace metadata API（假设 `api.workspaces.metadata` 存在）
- `vendor/index.html` 原型的视觉细节二次校准（间距、动画时长微调）
- dark mode 调色板设计（V2）
- Storybook 引入与组件 story 编写（可选）
- TUI/CLI 客户端是否复用 shell 抽象（V2 决策）

---

## 12. 参考文档

- `docs/client-ui-architecture.md` -- 现有客户端与 UI 架构（本 spec 的前置上下文）
- `docs/gui-implementation-architecture.md` -- GUI 实现架构
- `docs/novel-domain.md` -- Novel 业务域定义
- `docs/architecture.md` -- 整体架构
- `vendor/index.html` -- 设计原型
- `AGENTS.md` -- 仓库执行协议
