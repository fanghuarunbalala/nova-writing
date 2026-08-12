# Novel Harness

网络小说辅助创作 harness —— 从零重构的起点分支（`refactor/rewrite`）。

技术栈：TypeScript + pnpm monorepo。

## 目录结构

```
core/   @novel/core 核心包（业务逻辑逐层在此展开）
```

后续按层新增包（ui / cli / gui / web …）时，在 `pnpm-workspace.yaml` 中注册即可。

## 常用命令

```bash
pnpm install      # 安装依赖
pnpm build        # 构建所有包
pnpm dev          # core 包监听编译
pnpm typecheck    # 全包类型检查
```
