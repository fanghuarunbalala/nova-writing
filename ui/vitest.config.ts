/**
 * @novel/ui 单元/组件测试配置。
 * jsdom 环境 + testing-library；测试文件位于 tests/ 下，不进入 tsc 构建。
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    css: {
      // 仅处理并注入正文阅读器的 CSS Module（classNameStrategy 保类名），
      // 以便 toHaveStyle 校验 white-space: pre-wrap 行分割。
      // 其它模块/全局样式表一律不注入——组件 CSS 大量使用 hover-reveal
      // （pointer-events:none 等），jsdom 应用后会让 userEvent/getByRole 失效。
      include: [/domains\/novel\/manuscript\/.*\.module\.css$/],
      modules: { classNameStrategy: "non-scoped" },
    },
  },
});
