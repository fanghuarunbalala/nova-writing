/**
 * auto-compact 分析模块：三道门禁共用的占用度量、压缩区分区、novel 域元数据扫描
 * 与字符估算纯函数（无副作用；度量依赖 RunContext 上的用量信号回写）。
 */
import type { LoopContext } from "../../loop/LoopContext.js";
import type { RunContext } from "../../loop/types.js";
import type { LLMessage } from "../../provider/types.js";
import {
  CHARS_PER_TOKEN_FALLBACK,
  CALIB_FALLBACK,
  MAX_OUTPUT_FALLBACK,
  OMITTED_TOOL_RESULT_PREFIX,
  SUMMARY_MARKER,
  type AutoCompactConfig,
  type Measure,
  type NovelCallMeta,
} from "./auto-compact-shared.js";

// ── novel 域工具分类（新通用名 + 旧三件套名共存：历史会话消息里仍是旧工具名） ──

const NOVEL_READ_TOOLS = new Set([
  "NovelRead",
  // 旧六域 Read 名（合并前会话兼容）
  "NovelCharacterRead",
  "NovelLocationRead",
  "NovelParagraphRead",
  "NovelVolumeRead",
  "NovelChapterRead",
  "NovelOutlineRead",
]);

const NOVEL_WRITE_TOOLS = new Set([
  "NovelWrite",
  "NovelEdit",
  "NovelDelete",
  // 旧六域 Write/Edit 名（合并前会话兼容）
  "NovelCharacterWrite",
  "NovelCharacterEdit",
  "NovelLocationWrite",
  "NovelLocationEdit",
  "NovelParagraphWrite",
  "NovelParagraphEdit",
  "NovelVolumeWrite",
  "NovelVolumeEdit",
  "NovelChapterWrite",
  "NovelChapterEdit",
  "NovelOutlineWrite",
  "NovelOutlineEdit",
]);

/**
 * 解析 novel 工具调用：read 目标实体 id / write 实体 id 集（失败/非 novel 工具返回 undefined）
 * - read：顶层 *Id 字符串属性（characterId / paragraphId / …；省略 = 列表查询，无目标 id）
 * - write/edit/delete：values[].id（自选 id 缺省由宿主生成，无 id 则无法按实体追踪）；
 *   占位形态（T1 压缩产物）读顶层 ids 字符串数组——保证 lastWrite 跟踪跨压缩轮次不丢
 */
export function parseNovelCall(
  name: string,
  args: string,
): { kind: "read" | "write"; entityIds: Set<string> } | undefined {
  const isRead = NOVEL_READ_TOOLS.has(name);
  const isWrite = NOVEL_WRITE_TOOLS.has(name);
  if (!isRead && !isWrite) return undefined;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(args) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const entityIds = new Set<string>();
  if (isRead) {
    for (const [key, value] of Object.entries(parsed)) {
      if (key.endsWith("Id") && typeof value === "string" && value.length > 0) {
        entityIds.add(value);
      }
    }
  } else {
    const values = Array.isArray(parsed.values) ? (parsed.values as unknown[]) : [];
    for (const item of values) {
      const id = (item as Record<string, unknown> | null)?.id;
      if (typeof id === "string" && id.length > 0) entityIds.add(id);
    }
    // 占位形态：{"_compacted":"…","ids":["a","b"]}
    if (entityIds.size === 0 && Array.isArray(parsed.ids)) {
      for (const id of parsed.ids) {
        if (typeof id === "string" && id.length > 0) entityIds.add(id);
      }
    }
  }
  return { kind: isRead ? "read" : "write", entityIds };
}

/** 消息序列字符量（assistant 的 toolCalls 参数计入） */
export function messagesChars(messages: readonly LLMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += m.content.length;
    if (m.role === "assistant") {
      for (const tc of m.toolCalls ?? []) chars += tc.args.length;
    }
  }
  return chars;
}

/** 全部 run 的字符总量（信号回写/比例重估用） */
export function countRunChars(runs: readonly RunContext[]): number {
  return runs.reduce((acc, r) => acc + messagesChars(r.messages), 0);
}

/** 消息序列字符量估算 → token */
export function estimateTokens(messages: readonly LLMessage[]): number {
  return Math.ceil(messagesChars(messages) / CHARS_PER_TOKEN_FALLBACK);
}

/** run 是否为摘要 run（内容级标记，跨重启幂等） */
export function isSummaryRun(run: RunContext): boolean {
  return run.messages.some((m) => m.content.includes(SUMMARY_MARKER));
}

/** 工具结果是否已是占位（幂等检测） */
export function isOmittedToolResult(content: string): boolean {
  return content.startsWith(OMITTED_TOOL_RESULT_PREFIX);
}

/** 压缩区 runs（首 keepFirst 与尾 keepLast 之外；不足返回 undefined） */
export function zoneOf(
  runs: readonly RunContext[],
  keepFirst: number,
  keepLast: number,
): RunContext[] | undefined {
  if (runs.length <= keepFirst + keepLast) return undefined;
  return runs.slice(keepFirst, runs.length - keepLast);
}

/**
 * 扫描压缩区 + 保留尾区的 novel 工具调用（时序位置 = 消息序号）：
 * 保留尾区的后续写入同样使压缩区内的早期读/写过期。
 */
export function scanNovelMeta(runs: readonly RunContext[], keepFirst: number): NovelCallMeta {
  const calls = new Map<
    string,
    { kind: "read" | "write"; name: string; entityIds: Set<string>; pos: number }
  >();
  const lastWrite = new Map<string, { pos: number; callId: string }>();
  let pos = 0;
  for (let i = keepFirst; i < runs.length; i++) {
    for (const msg of runs[i]!.messages) {
      if (msg.role === "assistant") {
        for (const tc of msg.toolCalls ?? []) {
          const parsed = parseNovelCall(tc.name, tc.args);
          if (parsed === undefined) continue;
          calls.set(tc.id, { ...parsed, name: tc.name, pos });
          if (parsed.kind === "write") {
            for (const id of parsed.entityIds) {
              lastWrite.set(id, { pos, callId: tc.id });
            }
          }
        }
      }
      pos++;
    }
  }
  return { calls, lastWrite };
}

/** tool 结果是否为"后写覆盖前读"的过期读（含结果已占位时的判定复用） */
export function toolResultSuperseded(callId: string, content: string, meta: NovelCallMeta): boolean {
  if (isOmittedToolResult(content)) return false;
  const call = meta.calls.get(callId);
  if (call?.kind !== "read" || call.entityIds.size === 0) return false;
  return [...call.entityIds].some((id) => {
    const lw = meta.lastWrite.get(id);
    return lw !== undefined && lw.pos >= call.pos;
  });
}

/**
 * 当前占用度量 + 三条阈值线（无模型信号时 window 为 undefined，策略不动作）。
 * 占用估算：信号 × (当前字符 / 信号时字符)——压缩（折叠/骨架化/丢弃）后按比例收敛，
 * 而不是永远沿用压缩前的信号值；无 signalChars 的旧数据退化为直接用信号。
 */
export function measure(loop: LoopContext, cfg: AutoCompactConfig): Measure {
  const runs = loop.runs;
  const signal = scanLastSignal(runs);
  const charsNow = countRunChars(runs);
  let est: number;
  if (
    signal.inputTokens !== undefined &&
    signal.signalChars !== undefined &&
    signal.signalChars > 0
  ) {
    est = Math.round((signal.inputTokens / signal.signalChars) * charsNow);
  } else if (signal.inputTokens !== undefined) {
    est = signal.inputTokens;
  } else {
    est = Math.round((charsNow / CHARS_PER_TOKEN_FALLBACK) * CALIB_FALLBACK);
  }
  if (signal.model === undefined) {
    return {
      est,
      t1: Number.POSITIVE_INFINITY,
      t2: Number.POSITIVE_INFINITY,
      t3: Number.POSITIVE_INFINITY,
    };
  }
  const window = cfg.windowTokensOf(signal.model);
  const maxOutput = signal.maxOutputTokens ?? MAX_OUTPUT_FALLBACK;
  const t1 = Math.floor(window * cfg.t1Ratio);
  const t2 = Math.min(window - maxOutput - cfg.t2MarginTokens, Math.floor(window * cfg.t2CapRatio));
  const t3 = window - Math.floor(maxOutput / 2);
  return { model: signal.model, window, est, t1, t2, t3 };
}

/** 最近一次用量信号（从最新 run 向前找第一个有信号的） */
function scanLastSignal(runs: readonly RunContext[]): {
  inputTokens?: number;
  signalChars?: number;
  model?: string;
  maxOutputTokens?: number;
} {
  for (let i = runs.length - 1; i >= 0; i--) {
    const r = runs[i]!;
    if (r.lastInputTokens !== undefined || r.model !== undefined) {
      return {
        inputTokens: r.lastInputTokens,
        signalChars: r.signalChars,
        model: r.model,
        maxOutputTokens: r.maxOutputTokens,
      };
    }
  }
  return {};
}
