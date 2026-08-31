/**
 * 压缩前提取整理 pass（PRD memory-两层记忆 M4）：compact 判定通过、T1 骨架化
 * 执行前跑一次受限 housekeeping 子代理——输入 = 即将被压缩的完整 runs + 索引，
 * 工具面只给 Read / MemoryWrite / MemorySearch，职责 = 提取值得跨会话保留的内容
 * 写入 + 同义合并 + supersede 过时条目。这是原文销毁前的最后窗口（T2/T3 之后
 * journal 亦被全量重写）。
 *
 * 约束：①超时放行（默认 90s，超时 cancel 子代理循环、压缩主线绝不阻塞——
 * LoopContext 对本 pass 的 await 恒不抛错）；②轮次上限（默认 6）；③工具写入
 * 过 MemoryWrite 同一四道校验（source = 提取内容的来源会话与最大 run 序号）；
 * ④NOVEL.md 不可及（子代理无 Write/Edit）——冲突发现按 project 记忆落
 * 「待作者确认」，由主会话下轮提示走文件审批。
 */
import type { Provider } from "../provider/Provider.js";
import type { SamplingConfig } from "../provider/types.js";
import type { RunContext } from "../loop/types.js";
import { AgentLoop } from "../loop/AgentLoop.js";
import type { AgentCapability } from "./AgentCapability.js";
import { MapToolDispatcher } from "../tool/MapToolDispatcher.js";
import { createFileTools } from "../tool/definitions/files.js";
import { createMemoryTools } from "../tool/definitions/memory.js";
import type { Logger } from "../../log/Logger.js";

/** pass 超时（超时 cancel；压缩放行） */
const DEFAULT_TIMEOUT_MS = 90_000;
/** pass 轮次上限（提取是小任务，防失控） */
const DEFAULT_MAX_TURNS = 6;
/** 序列化总量上限（字符；超出从最新一端截断——最旧内容价值最低且最先被压缩） */
const TRANSCRIPT_MAX_CHARS = 60_000;
/** 单消息截断（字符） */
const MESSAGE_MAX_CHARS = 2_000;

/** 提取 pass 选项 */
export interface MemoryExtractionPassOptions {
  /** 工作区根（memory/ 与 NOVEL.md 所在） */
  workspace: string;
  /** Provider 实例（与会话同一 provider；pass 内新建 AgentLoop 使用） */
  provider: Provider;
  /** 来源会话 id（source = <conversationId>#<最大 run 序号>） */
  conversationId: string;
  /** 两层 NOVEL.md 文本（MemoryWrite skip 机械校验用） */
  staticLayerTexts: () => Promise<readonly (string | undefined)[]>;
  logger?: Logger;
  /** 超时（缺省 90s） */
  timeoutMs?: number;
  /** 轮次上限（缺省 6） */
  maxTurns?: number;
}

/** 序列化 runs → 供提取的转录文本（user/assistant 正文 + 工具调用名；截断保最新） */
export function serializeRunsForExtraction(runs: readonly RunContext[]): string {
  const blocks: string[] = [];
  for (const run of runs) {
    for (const message of run.messages) {
      let text = "";
      if (message.role === "user") {
        text = typeof message.content === "string" ? message.content : "";
      } else if (message.role === "assistant") {
        const parts: string[] = [];
        if (typeof message.content === "string" && message.content.length > 0) {
          parts.push(message.content);
        }
        for (const tc of message.toolCalls ?? []) {
          parts.push(`[调用工具 ${tc.name}]`);
        }
        text = parts.join("\n");
      } else if (message.role === "tool") {
        // 工具结果体量大且骨架化目标就是它们——只留标记，不搬正文
        text = `[工具结果 ${message.id ?? ""}]`;
      }
      text = text.trim();
      if (text.length === 0) continue;
      if (text.length > MESSAGE_MAX_CHARS) text = `${text.slice(0, MESSAGE_MAX_CHARS)}…`;
      blocks.push(`【run ${run.seq}·${message.role}】${text}`);
    }
  }
  let transcript = blocks.join("\n\n");
  if (transcript.length > TRANSCRIPT_MAX_CHARS) {
    transcript = `（更早内容已截断）\n\n${transcript.slice(transcript.length - TRANSCRIPT_MAX_CHARS)}`;
  }
  return transcript;
}

/** 提取 pass 系统提示（受限职责 + 路由/skip 指引浓缩版） */
function extractionSystemPrompt(): string {
  return [
    "# 记忆提取整理（压缩前）",
    "",
    "你是记忆管家。对话上下文即将被压缩（细节将被摘要/丢弃），这是把值得跨会话保留的内容存盘的最后窗口。给你一份对话转录，请做一次提取与整理。",
    "",
    "## 步骤",
    "1. 先用 Read 读 `memory/MEMORY.md`（现有记忆索引）与 `NOVEL.md`（项目静态约束）。",
    "2. 从转录中提取**值得跨会话保留**的内容，用 MemoryWrite 写入。",
    "3. 顺手整理：发现与既有条目同义/重复 → 同名更新；发现既有条目已被转录中的新说法取代 → 新 name + supersedes 旧条目。",
    "4. 完成后直接结束（无需汇报正文）。",
    "",
    "## 提取标准（按序判定）",
    "- **author**：作者画像（水平/口味/阅读背景）。",
    "- **feedback**：作者对产出的反馈——**纠正与肯定都记**（「别用 X」「这个节奏很好保持」）。",
    "- **project**：本项目决策与坑（实体库/journal 查不到的；相对日期转绝对日期）。",
    "- **reference**：外部资源指针（只存去哪找）。",
    "",
    "## 不要写入（作者显式要求保存也适用）",
    "- NOVEL.md 已声明的约束（静态层管的）；",
    "- 角色/剧情/大纲等实体事实（实体库管）；",
    "- 会话内临时状态（当前写哪章、刚讨论的草稿）。",
    "发现「作者意图与 NOVEL.md 冲突」（如想改人称）：写一条 project 记录注明「与静态层冲突，待作者确认」，不要尝试修改 NOVEL.md。",
    "",
    "0 次写入是合法结果——没有值得保留的就直接结束，不要为了写而写。",
  ].join("\n");
}

/**
 * 创建压缩前提取整理 pass
 * @param opts 选项（workspace/provider/conversationId/静态层文本）
 * @returns pass 执行器（LoopContext 在 compact 判定通过后调用；恒不抛错）
 */
export function createMemoryExtractionPass(opts: MemoryExtractionPassOptions): {
  run: (sampling: SamplingConfig, runs: readonly RunContext[]) => Promise<void>;
} {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  return {
    async run(sampling, runs) {
      if (runs.length === 0) return;
      // source = 提取内容的来源（最大 run 序号；对齐主循环 <会话id>#<run序号> 粒度）
      const maxSeq = runs.reduce((acc, r) => Math.max(acc, r.seq), 0);
      const getSource = () => `${opts.conversationId}#${maxSeq}`;
      const tools = [
        ...createFileTools(opts.workspace).filter((t) => t.name === "Read"),
        ...createMemoryTools({
          workspace: opts.workspace,
          getSource,
          staticLayerTexts: opts.staticLayerTexts,
        }).filter((t) => t.name !== "MemoryForget"),
      ];
      const capability: AgentCapability = {
        systemSections: [
          {
            kind: "static",
            id: "memory.extract",
            version: "1.0.0",
            label: "Memory Extraction",
            render: () => extractionSystemPrompt(),
          },
        ],
        toolDefs: tools,
        compactPolicies: [],
        nudgePolicies: [],
      };
      const loop = new AgentLoop({
        workspace: opts.workspace,
        provider: opts.provider,
        agentCapability: capability,
        toolDispatcher: new MapToolDispatcher(tools),
        conversationId: opts.conversationId,
        agentId: "memory-extract",
        logger: opts.logger,
      });
      const transcript = serializeRunsForExtraction(runs);
      let timedOut = false;
      // 超时放行：deadline 到点 cancel 循环并直接返回——provider 若不响应 abort
      // 信号（悬挂），pass 也必须在限时内返回，压缩主线绝不被阻塞
      let settle: () => void = () => {};
      const deadline = new Promise<void>((resolve) => {
        settle = resolve;
      });
      const timer = setTimeout(() => {
        timedOut = true;
        loop.cancel();
        settle();
      }, timeoutMs);
      try {
        await Promise.race([
          loop.run(
            `以下是即将被压缩的对话转录，请按系统指引做记忆提取与整理：\n\n${transcript}`,
            { sampling, maxTurns },
          ),
          deadline,
        ]);
        if (!timedOut) {
          opts.logger?.debug("memory.extraction_pass.done", { conversationId: opts.conversationId });
        }
      } catch (error) {
        // pass 失败（含超时 cancel 的中止错误）不影响压缩主线
        opts.logger?.debug("memory.extraction_pass.failed", {
          conversationId: opts.conversationId,
          failure: error instanceof Error ? error.message : String(error),
        });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
