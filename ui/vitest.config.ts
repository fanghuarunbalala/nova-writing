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
      modules: { classNameStrategy: "non-scoped" },
    },
  },
});
