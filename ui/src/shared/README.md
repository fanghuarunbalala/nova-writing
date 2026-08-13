# @novel/ui shared 层

按 `docs/superpowers/specs/2026-08-05-frontend-architecture-design.md` 第 1、2 节实现。

## 目录

- `theme/` — design tokens（`tokens.css`，数值对齐 `vendor/index.html` 原型 `:root`）、
  `global.css`、`animations.css`、`ThemeProvider`/`useTheme`
- `state/` — `ExternalStore` 基类、`ImmutableSnapshot`、`useExternalStore`、
  `TaskSerializer`、`ToastStore`
- `routing/` — `MainViewRouter`、`InspectorRouter`、`MainViewHistory`、hooks
- `primitives/` — 基础组件（Button/IconButton/Icon/Spinner/Badge/Pill/Avatar/Kbd/Text/
  Separator/Dialog/Dropdown/Tabs/Tooltip/DragHandle），样式走 CSS Modules + tokens

## 依赖规则（ESLint 强制）

- `shared/*` 只能 import `@novel/core` 与 React；禁止 import 域或 shell
- `domains/*`、`shell/*` 的约束见 `ui/.eslintrc.cjs` overrides

## 测试

`pnpm --dir ui test`（vitest + jsdom + testing-library）。
视觉快照不在 Phase 1 做 HTML demo；原型对齐由 Phase 3 真实应用 Playwright 截图验证。
