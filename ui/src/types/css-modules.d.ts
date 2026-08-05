/**
 * CSS Modules 与全局 CSS 的 TypeScript 声明。
 * tsc 不处理 CSS 文件；此声明让 `import styles from "./X.module.css"`
 * 与 `import "./global.css"` 通过类型检查。CSS 由 Vite（gui/web）消费，
 * 构建时 scripts/copy-css.mjs 负责复制到 dist。
 */
declare module "*.module.css" {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}

declare module "*.css";
