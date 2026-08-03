# Novel Harness

网络小说辅助创作 harness 项目。

目标是让每个人都能把想象力转化为可持续连载的网络小说，而不是把创作局限在传统写作技巧上。

## 技术路线

- `core` 是唯一共享核心包，内部暂时只涵盖 `runtime`、`tools`、`config`、`prompt`。
- `runtime` 先按中性适配层设计，后续再决定接入具体 runtime 实现。
- TypeScript 作为主要 core 实现，用于快速迭代创作流程、agent 编排、状态管理和产品逻辑。
- Rust 作为 accelerator，用于后续重写性能关键路径，例如大文本处理、检索索引、diff、规则校验和批量解析。
- pi agent 作为 runtime 约定，负责对话状态、任务编排和 tool 调度。
- CLI、GUI、Web 共享同一套 `@novel/core` 接口。

## 当前阶段

Runtime、Novel Domain、共享 UI、Web 和 Electron 安全壳正在按架构文档逐步实现。

## 启动桌面 GUI

```bash
pnpm gui
```

该命令构建 Core、共享 UI、Electron Main/Preload/Renderer，并启动真实 Electron 窗口。当前可查看和操作共享应用 Shell、Workspace 入口与 Settings；本地 Workspace Host 和 Agent Runtime 仍按后续步骤接入。
