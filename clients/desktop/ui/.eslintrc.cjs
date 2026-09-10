/**
 * @novel/ui ESLint 配置
 *
 * 强制执行 spec 1.2 的三层依赖规则（domains / shell / shared）：
 * - domains/*  不得 import shell/* 或其他域
 * - shell/*    不得直接 import @novel/core/node 或平台 API
 * - shared/*   只能 import @novel/core 与 React
 *
 * 规则只作用于新架构目录；现有旧目录（src/conversation 等）在迁移完成前豁免。
 */
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  env: { browser: true, es2022: true, node: true },
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
  ignorePatterns: ["dist/", "node_modules/", "scripts/"],
  rules: {
    // 代码库惯例以 _ 前缀标记"有意未使用"的参数（如延后实现的桩方法）
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
  },
  overrides: [
    {
      files: ["src/domains/**/*.{ts,tsx}"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              { group: ["**/shell/**"], message: "domains must not import shell/*" },
              { group: ["**/domains/**"], message: "domains must not import other domains" },
            ],
          },
        ],
      },
    },
    {
      files: ["src/shell/**/*.{ts,tsx}"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["**/core/node/**", "electron"],
                message: "shell must not import core/node or platform APIs directly",
              },
            ],
          },
        ],
      },
    },
    {
      files: ["src/shared/**/*.{ts,tsx}"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["**/domains/**", "**/shell/**"],
                message: "shared must not import domains or shell",
              },
            ],
          },
        ],
      },
    },
  ],
};
