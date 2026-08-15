# UI 样式架构（CSS 结构 / 设计 / 分层）

✅ 已定稿（2026-08-14，feat/ui-style-architecture M0–M4 落地，PR #11 合并入 main）。

前端样式按三个关注面组织，**ui 包一切样式改动必须遵守本文件**：

1. **CSS 结构** —— 文件拓扑与引入方式（谁定义、谁引入、谁豁免）；
2. **设计** —— 三层 token 模型与命名约定（变化机制决定层级）；
3. **样式分层** —— 全局 vs 模块的职责边界，及纪律工具执法。

## 1. CSS 结构

### 1.1 全局主题文件（`ui/src/shared/theme/`）

| 文件 | 职责 |
| --- | --- |
| `tokens.css` | 全部设计 token（三层模型单文件承载；dark 落地时色层可再拆） |
| `global.css` | 盒模型重置、根背景、排版基线、`prefers-reduced-motion` 降级、`.sr-only`、细滚动条/选区/focus-visible、`.kicker` |
| `animations.css` | **全仓唯一允许定义 `@keyframes` 的文件**（纪律规则 c 执法）+ 通用动画 utility class |
| `settings.css` | 模型设置面板全局类（`.novel-*`）——desktop/web 双宿主共享同一套类名，故以全局样式随设计系统下发 |

### 1.2 引入拓扑

- 宿主入口 CSS 一次 `@import` 上述四个文件（gui：`gui/src/renderer/renderer.css`），**禁止在 TSX 中副作用引入**全局主题 css。漏 import 的代价：`animations.css` 曾漏引入导致 `grad-flow` 从未运行（fix c375f79）。
- 组件私有样式一律 `*.module.css` 与组件同目录（现役 98 个）。
- `ThemeProvider` 写 `<html data-theme="...">` 根属性（**必须挂 html**：挂 body 时 `:root` 级语义混合 token 已按旧基色解析，不会跟随覆盖）。现役 4 套主题：宣纸白（`:root` 默认，无覆盖块）、墨夜/黛青/雪青（`[data-theme]` 覆盖块，见 tokens.css 文件尾）；选择持久化 `localStorage("novel.theme")`，切换时挂 `html.theming` 做 0.35s 全局颜色过渡（400ms 摘除）。主题候选与对比度校验过程见 `docs/design/theme-candidates-demo-2.html`（历史候选在 git 记录中）。

### 1.3 样式分层职责边界

| 层 | 内容 | 约束 |
| --- | --- | --- |
| 模块 css（`*.module.css`） | 组件私有样式 | 纪律规则 a/d 执法（禁颜色字面量、px 字面量走 token） |
| 全局主题 css（tokens/global/animations/settings） | token 定义、基线、共享动画、跨宿主共享面板 | 天然豁免组件级字面量规则（定义层） |
| inline style | **仅动态值**（如 InspectorHost 拖拽写入 `--insp-w`） | 静态样式一律进 module.css |

## 2. 设计：三层 token 模型

分层原则：**变化机制决定层级**——theme 覆盖只允许触达 L3。

| 层 | 内容 | 变化机制 |
| --- | --- | --- |
| **L1 结构常量** | 布局尺寸（`--topbar-height`/`--sidebar-width`/`--insp-w`）、max-width 快照、z-index 角色刻度 | media query / JS inline 调节，**不随 theme 变化** |
| **L2 设计语言** | 字体栈、字号/字重/间距/圆角刻度、品牌渐变、动画时长缓动、动画名 token（`--anim-*`） | 只有改版或密度设置才变，**不随 theme 变化** |
| **L3 语义色 + 阴影** | `--color-*` / `--shadow-*` | **唯一允许 `[data-theme]` 覆盖块覆盖的层**（纪律规则 b 执法；覆盖块必须完整覆盖基色集合+全部阴影，themePalettes 契约测试执法） |

多主题落地路径：只覆盖 L3（覆盖块只允许 `--color-*` / `--shadow-*`），组件零改动；语义混合 token 在 `:root` 引用基色、自动重derive。暗色主题额外覆盖 `--color-on-accent` 为深墨（强调底提亮后白字对比度不足 4.5:1）。

### 2.1 命名约定

- **语义型主干**：`--fs-h1/body`、4px 刻度 `--space-1..16`、`--fw-regular` 等；新 UI 优先使用。
- **精确值快照**：原型遗留的精确像素值（`--fs-12`、`--space-13px`、`--fw-750`、`--radius-10px`），保证与 `vendor/index.html` 原型像素一致；非刻度值先建快照 token，禁止字面量散落组件。
- **两次晋升制（语义混合色）**：完全相同 (基色, 百分比, target) 的 color-mix 组合在全仓出现 **≥2 次**才晋升为 `--color-{base}-{N}`；同名 (基色, %) 多 target 时全部带 target 后缀（`--color-danger-12-surface` / `-transparent`）；频次 1 的组合留在组件内（color-mix 引用基色 token，dark 覆盖基色后自动适配）。
- **角色 token**：角色唯一且跨主题语义明确的混合色（`--color-chrome-bg`、`--color-focus-ring`、`--color-scrollbar-*`），不受两次晋升制约束。
- z-index 是**角色刻度**：同名不同值不合并（`--z-decor` 与 `--z-drag-handle` 同值不同角色并存）。
- 颜色统一 OKLCH；品牌渐变（`--grad-accent`）是美术资产，dark 沿用不改。

## 3. 动画：keyframes 集中 + `--anim-*` 间接引用

**坑（重要，勿重蹈）**：Vite 8（rolldown）的 CSS Modules 管线对模块 css 内所有 animation 引用**无条件 hash 重命名**——即使模块内无本地 @keyframes，引用也会变成 `_name_hash_1` 且无对应定义，动画静默失效（`grad-flow` 曾因此从未运行，即使 animations.css 已 import）。

**解法（现行约定）**：

1. 所有 `@keyframes` 集中定义在 `shared/theme/animations.css`（纪律规则 c 执法：其他文件禁止定义、名不重复）。
2. 模块 css 经动画名 token 间接引用：tokens.css L2 定义 `--anim-*` → 组件写 `animation: var(--anim-grad-flow) ...`（var() 值不被重命名）。
3. 动画参数（时长/缓动/iteration）留在组件侧；keyframes 命名 kebab-case。
4. 同名且帧体相同的关键帧合并一份；近似不同（如 view-in 家族）各自保留。

**失败的替代方案（勿再试）**：`composes: X from global`（被管线静默丢弃）、值内 `:global(...)`（postcss 语法错误）。

## 4. 纪律工具（执法）

| 工具 | 命令 | 内容 |
| --- | --- | --- |
| 纪律测试 | `pnpm --dir ui test tests/theme` | `cssDiscipline.test.ts` 规则 a–d + `tokenReferences.test.ts` |
| stylelint | `pnpm --dir ui lint:css`（`check` 已并入） | 功能规则最小集；`color-no-hex` 仅作用于 `*.module.css`（与规则 a 互为兜底） |
| 批量替换 | `node ui/scripts/apply-token-map.mjs [--apply]` | 字面量→token 等值替换；dry-run 默认、按属性上下文、幂等 |

规则 a–d（`ui/tests/theme/cssDiscipline.test.ts`，违规时 vitest diff 输出人类可读清单）：

- **a)** 模块 css 禁止颜色字面量（#hex / rgb(a) / hsl(a) / oklch）；行内 `/* @allow-color 理由 */` 豁免
- **b)** `[data-theme]` 覆盖块只允许 `--color-*` / `--shadow-*`（三层模型执法）
- **c)** `@keyframes` 只允许定义在 `animations.css` 且名不重复
- **d)** 设计语言类属性（padding/margin/gap/inset/定位偏移/font-size/letter-spacing/border-width/border-radius 等）px 字面量只允许 0/1px，其余必须 `var(--token)`；`font-weight` 纯数字违规，必须 `var(--fw-*)`

`tokenReferences.test.ts`：组件 css 引用的每个 `var(--*)` 必须定义在 tokens.css（防拼写错误与绕过 token 硬编码）。

**原则：绝对像素一致。** token 化是等值替换（字面量 → 同值 token），不是归一化；stylelint 关闭 notation 三件套等会改写值的规则。

## 5. 新样式的操作清单

1. 组件私有样式进 `*.module.css`（与组件同目录）；仅跨宿主共享面板用全局类。
2. 颜色/字号/字重/间距/圆角/z-index/动画一律 `var(--token)`；token 不存在时：刻度值用语义型，非刻度值建精确值快照，语义混合色按两次晋升制。
3. 新动画：`@keyframes` 进 animations.css（kebab 命名），模块内经 `var(--anim-*)` 引用。
4. 静态值禁 inline style；inline 仅动态值。
5. 收尾跑 `pnpm --dir ui test tests/theme` + `pnpm --dir ui lint:css` 全绿。

实现参考：`ui/src/shared/theme/tokens.css`、`animations.css`、`ui/tests/theme/cssDiscipline.test.ts`、`ui/stylelint.config.mjs`。
