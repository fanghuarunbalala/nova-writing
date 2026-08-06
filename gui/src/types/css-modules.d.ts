/**
 * CSS Modules 与全局 CSS 的 TypeScript 声明（gui 包专用）。
 *
 * tsc 不处理 CSS 文件；此声明让 `import styles from "./X.module.css"` 与
 * `import "./global.css"` 通过类型检查。CSS 由 Vite（gui renderer 构建）
 * 消费，运行时由 electron-renderer 处理。
 *
 * 与 ui/src/types/css-modules.d.ts 同构；若未来 gui 引入更多 CSS Modules
 * （例如 platform/features 域），无需修改本声明。
 */
declare module "*.module.css" {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}

declare module "*.css";
