# Novel Harness 产品需求文档（PRD）—— v0.3

> 状态：基于当前 `refactor/rewrite` 分支架构重写
> 技术实现见 `docs/architecture.md`；执行清单见 `docs/tasks.md`

---

## 1. 产品定位

一个让创作者把想象力转化为可持续连载网络小说的 AI 辅助创作 harness。

**人主导创作，AI 辅助推进**：先想清楚要写什么（compose），经创作者审批后再落笔，让每一步可控、可预期。

---

## 2. 目标用户

| 用户 | 核心诉求 |
|---|---|
| 新手作者 | 降低起步门槛，AI 帮忙起稿、补设定、给方向 |
| 连载作者 | 设定/大纲不丢，多线推进，卡文时快速出方向 |
| 多开作者 | 多会话并行、互不干扰，进度清晰可查 |

---

## 3. 核心痛点

1. 灵感难持续（卡文、断更）
2. 设定易混乱（人物/大纲/伏笔前后矛盾）
3. 长文上下文丢失（AI 越聊越忘）
4. 创作过程不透明/不可控（AI 直接落笔，无法在动笔前干预）

---

## 4. 核心功能需求（映射当前架构）

### 4.0 概念约定
- **一轮（round）**：一次"用户输入 → 助手完整回复"。
- **一个 turn**：一次 provider call。一轮可能含多次 turn（多轮工具调用）。

### 4.1 多模型 Provider —— `runtime/provider`
- 统一接口接多提供商（Anthropic / OpenAI / DeepSeek），差异在适配层消化。
- 流式（delta 回调）、采样配置（模型/温度/maxToken/思考档位）、错误分类（限流/费用/认证/超时/取消…）。
- 模型能力注册（温度/思考模式/档位收敛）。

### 4.2 Agent 运行时 —— `runtime/loop` + `runtime/agent` + `runtime/tool`
- **AgentLoop**：round/turn 循环，工具执行，产出 `OutputEvent`。
- **AgentCapability**：agent 能力（system 分段 + 工具 + 策略），由 `Registry` 组装。
- **工具三件套**：ToolDef（定义+实现+prompt 细节）/ ToolRegistry / ToolDispatcher（注入）。

### 4.3 上下文管理 —— `runtime/compact` + `runtime/nudge` + `runtime/prompt`
- **压缩**（compact）：策略链，超长时保留关键设定。
- **提示注入**（nudge）：持久追加 / 瞬时插入。
- **prompt 分节**：静态缓存 + 动态渲染 + 工具 prompt 细节（policy/guidance）。

### 4.4 会话持久化 —— `conversation`
- **journal 按 turn 存储**（LLMessage），读侧返回 `OutputEvent`（无 delta），进程无关可读。
- 只 main 落盘，subagent 不持久化。
- 崩溃恢复（seq 对齐 + 重放）。

### 4.5 会话编排 —— `conversation/server`（⏳ 待实现）
- **Conversation**：组织 AgentLoop + journal + 事件 + 审批 + compose 模式。
- **ConversationManagerServer**：生命周期 + 消息调度 + spawn/terminate + 审批路由。

### 4.6 小说数据域 —— `novel`
- 卷章节 / story unit / 设定 / 大纲 / 伏笔的 query/mutation/变更推送。

### 4.7 通信 —— `rpc`（kkrpc）+ `event`
- RPC 三态（request/response/notify），错误归一 `RPCError`。
- 事件发布/订阅（ZeroMQ PUB/SUB）。

### 4.8 可观测性 —— `log` + `runtime/debug`
- 结构化日志（event 名 + 字段，不泄露密钥），每进程独立落盘。
- Provider 请求调试（jsonl + html 差异视图）。

---

## 5. 非功能需求

| 需求 | 说明 |
|---|---|
| 异步不阻塞 | agent loop 全异步 |
| 进程隔离 | 每 conversation 一进程 |
| 崩溃可恢复 | journal 重放 + host_close 优雅中止 |
| 可测试 | 核心可单测（mock provider/dispatcher） |

---

## 6. 当前架构与完成度

```
core/src/
├── runtime/           ✅ agent 运行时（provider/tool/agent/registry/prompt/compact/nudge/loop/debug）
├── conversation/      ⏳ contract+persistence 就绪；server/Conversation、ConversationManagerServer 空壳
├── novel/             ✅ contract+model+client+server+store
├── rpc/               ✅ kkrpc（call/RPCError/transport）
├── event/             ✅ EventPublisher/Subscriber（ZeroMQ）
├── manager/           ⏳ contract 就绪；实现待接
└── log/               ✅ pino（进程独占）
```

**已实现**：Provider、AgentLoop、Registry、Journal、Novel 契约、RPC、事件、日志、调试器（100 测试全绿 + 真实 deepseek 联调）。

**待实现**：Conversation 编排、ManagerServer、审批/compose 接通、上层组装、GUI。

---

## 7. 待确认问题

1. compose 模式的审批粒度（每章/每情节点）
2. 设定/大纲编辑体验（后续定）
3. subagent 读写边界（旧实现只读，是否下放写）
