# Claude Code（vendor）提示词与工具参考

本目录是对 `D:\workplace\NovelAI-Compose\vendor\claude-code` 中 Claude Code 源码的
**忠实记录**：system prompt、system reminder、工具描述（desc）与工具 schema。

> 提取时间：2026-08-16。所有引文均为原文照录（模板变量以 `{{...}}` 标注），
> 每节注明源码位置。文件里同时记录了各内容块的**触发条件**（feature flag /
> env 判断），因为这些条件决定了实际运行时会拼出哪一份 prompt。

## 目录

| 文件 | 内容 |
| --- | --- |
| [system-prompt.md](./system-prompt.md) | 主 system prompt：静态段全文 + 动态段（session guidance / env / language / output style / memory 等）及各自的触发条件 |
| [subagents.md](./subagents.md) | 子 agent 的 system prompt：DEFAULT_AGENT_PROMPT、enhanceSystemPromptWithEnvDetails 追加段、6 个 built-in agents（Explore / general-purpose / Plan / verification / statusline-setup / claude-code-guide） |
| [modes.md](./modes.md) | mode 系统：6 个内置 mode 的 systemPrompt + Claude persona 模板 |
| [memory-prompt.md](./memory-prompt.md) | 持久化记忆系统 prompt（四类记忆 taxonomy、存取规则、防漂移条款） |
| [system-reminders.md](./system-reminders.md) | 全部 `<system-reminder>` 运行时注入文本（proactive / coordinator / brief / side question / 记忆上下文等） |
| [tools/](./tools/README.md) | 全部 60+ 工具：每个一份，含模型侧描述（prompt.ts）+ input schema |

## 关键源码位置

| 内容 | 源码 |
| --- | --- |
| 主 system prompt 组装 | `vendor/claude-code/src/constants/prompts.ts`（`getSystemPrompt`） |
| section 缓存机制 | `src/constants/systemPromptSections.ts`（memoized / uncached 两类） |
| cyber risk 指令（Safeguards 团队所有） | `src/constants/cyberRiskInstruction.ts` |
| 模式 persona | `src/modes/defaults.ts`、`src/modes/personas/claude.ts` |
| 记忆系统 prompt | `src/memdir/memdir.ts`、`src/memdir/memoryTypes.ts` |
| built-in agents | `packages/builtin-tools/src/tools/AgentTool/built-in/*.ts` |
| 工具定义 | `packages/builtin-tools/src/tools/<ToolName>/`（`prompt.ts` = desc，`<ToolName>.ts(x)` 内 zod `inputSchema`） |
| 工具注册表 | `src/tools.ts`（`getAllBaseTools`，含各工具 feature flag 门槛） |

## 提取时注意到的结构要点

1. **prompt 是运行时组装的**，不是一份静态文本。`getSystemPrompt` 按
   `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` 分静态（可跨用户缓存）/动态两段；动态段
   由 `systemPromptSection`（memoized，/clear 或 /compact 才失效）与
   `DANGEROUS_uncachedSystemPromptSection`（每轮重算）两类组成。
2. **大量内容被 feature flag 门控**（`feature('PROACTIVE')` / `KAIROS` /
   `EXPERIMENTAL_SKILL_SEARCH` / `process.env.USER_TYPE === 'ant'` 等），
   外部构建与 ant 内部构建会得到不同的 prompt。本目录记录的是源码中
   **全部**内容块，并标注各自的启用条件。
3. **工具分 core / deferred 两类**：core 工具（Read/Edit/Write/Bash/Glob/Grep/
   Agent/WebFetch/WebSearch/Skill/SearchExtraTools/ExecuteExtraTool 等）直接可调；
   deferred 工具（TeamCreate、CronCreate、SendMessage 等）需先
   `SearchExtraTools` 发现再经 `ExecuteExtraTool` 调用——这条规则本身就在
   system prompt 里（`getSimpleSystemSection`）。
4. **每轮注入的 `<system-reminder>`**（proactive tick、brief 切换、记忆上下文等）
   是 prompt 体系的一部分，与主 system prompt 分开记录于
   `system-reminders.md`。
