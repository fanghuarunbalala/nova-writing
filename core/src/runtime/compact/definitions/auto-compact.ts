/**
 * 自动上下文压缩策略（docs/PRD/context-compact.md）：三道门禁顺序判定，
 * 单次 compact 内 T1 结构化骨架化 → T2 逐段摘要折叠 → T3 硬丢弃收敛。
 *
 * - 阈值信号：最近一次 provider 回报的 inputTokens（RunContext.lastInputTokens）；
 *   无信号时按字符估算（校准比例自信号推导）
 * - T1（≥70%·window，零成本）：压缩区骨架化——通用长度规则 + novel 域规则
 *   （同实体多次写只保留最后一次调用记录；后写覆盖前读）
 * - T2（≥ window−maxOutput−余量，≤92%）：折叠最老未摘要段为一条摘要 run（一次一段；
 *   摘要 run 只增不并、永不再摘要——防信息失真）
 * - T3（≥ window−maxOutput/2）：从最老开始硬丢弃整 run（含旧摘要 run；首 run 最后丢）
 * - 协议约束：tool result 只替换不删除（与 toolCall 按 id 配对，防 provider 400）
 */
import type { LoopContext } from "../../loop/LoopContext.js";
import type { RunContext } from "../../loop/types.js";
import type { ContextCompactPolicy } from "../ContextCompactPolicy.js";
import type { Provider } from "../../provider/Provider.js";
import type { LLMessage, ProviderCall } from "../../provider/types.js";
import type { Logger } from "../../../log/Logger.js";

// ── novel 域工具分类（名字前缀即可判定读写） ──

const NOVEL_READ_TOOLS = new Set([
  "NovelCharacterRead",
  "NovelLocationRead",
  "NovelParagraphRead",
  "NovelVolumeRead",
  "NovelChapterRead",
  "NovelOutlineRead",
]);

const NOVEL_WRITE_TOOLS = new Set([
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
  "NovelDelete",
]);

// ── 占位文案（前缀即幂等检测标记） ──

const OMITTED_TOOL_RESULT_PREFIX = "[工具结果已省略";
const ARCHIVED_NOVEL_PREFIX = "[正文已入档";
const COMPACTED_ARGS_MARK = '"_compacted"';
const COMPACTED_ARGS_COVERED = '{"_compacted":"该写入已被后续写入覆盖，正式稿以最后一次为准"}';
const SUMMARY_MARKER = "<context-summary>";

// ── T1 长度阈值 ──

/** 工具结果超过该字符数替换为一行占位 */
const TOOL_RESULT_PLACEHOLDER_CHARS = 500;
/** 工具参数超过该字符数视为超长（写入内容以正式稿为准） */
const TOOL_ARGS_PLACEHOLDER_CHARS = 800;
/** assistant 评述（去正文块后）超过该字符数做头尾截断 */
const ASSISTANT_TEXT_TRIM_CHARS = 1000;
const ASSISTANT_TEXT_KEEP_HEAD = 400;
const ASSISTANT_TEXT_KEEP_TAIL = 200;
/** 最小折叠段字符量：段比摘要本身还小时折叠得不偿失（est 反升），压力交给 T3 */
const MIN_FOLD_CHARS = 1_000;

/** 字符 → token 估算比例（中文为主保守取 2 字/token；有信号时按校准比例替代） */
const CHARS_PER_TOKEN_FALLBACK = 2;
/** 无信号时的校准兜底（含 system/tools 开销的粗放大） */
const CALIB_FALLBACK = 1.5;
/** 信号缺失时 maxOutput 兜底 */
const MAX_OUTPUT_FALLBACK = 8192;
/** 窗口查询失败兜底 */
const WINDOW_FALLBACK = 128_000;

/** 摘要请求 system prompt（结构化中文；正文已入正式稿，不复述） */
const SUMMARY_SYSTEM_PROMPT = [
  "你是对话历史压缩器。请把给定的历史对话压缩为一份结构化中文摘要，供同一助手后续继续创作时使用。",
  "要求：",
  "- 只依据给定内容，不编造；保留所有关键事实",
  "- 按以下结构输出（无内容的节省略）：",
  "  ## 关键事实与背景",
  "  ## 已做决策（含被拒绝或放弃的方向）",
  "  ## 实体与正文变更（列出涉及的实体 id、名称与变更要点；正文已入正式稿，不要复述正文内容）",
  "  ## 伏笔与待办（未完成事项、作者表达的偏好与要求）",
  "- 简洁致密，总量不超过 1500 字",
].join("\n");

/** 策略构造选项（缺省值见各项注释） */
export interface AutoCompactOptions {
  /** T1 触发比例（缺省 0.7） */
  t1Ratio?: number;
  /** T2 余量 token（缺省 12000）：T2 线 = window − maxOutput − 余量 */
  t2MarginTokens?: number;
  /** T2 线上限比例（缺省 0.92） */
  t2CapRatio?: number;
  /** 摘要段输入 token 预算（缺省 40000；每次触发折一段） */
  summarySegmentTokens?: number;
  /** 摘要输出上限 token（缺省 2048） */
  summaryMaxTokens?: number;
  /** 保留首部 run 数（缺省 1：作者意图） */
  keepFirst?: number;
  /** 保留尾部 run 数（缺省 3；执行中 run 恒在其中） */
  keepLast?: number;
  /** 窗口查询（缺省经 provider.getModelInfo；查不到兜底 128k） */
  windowTokensOf?: (model: string) => number;
  /** 结构化日志（可选） */
  logger?: Logger;
}

/** novel 工具调用元数据（结构化压缩域规则的判定依据） */
interface NovelCallMeta {
  /** 消息位置计数基准上的调用表：toolCallId → { kind, name, entityIds, pos } */
  calls: Map<
    string,
    { kind: "read" | "write"; name: string; entityIds: Set<string>; pos: number }
  >;
  /** 实体 id → 最后一次写入（位置 + callId） */
  lastWrite: Map<string, { pos: number; callId: string }>;
}

/** 占用度量：阈值线 + 估算 */
interface Measure {
  model?: string;
  window?: number;
  /** 当前占用估算（信号 × 字符比例；无信号按字符×保守系数） */
  est: number;
  t1: number;
  t2: number;
  t3: number;
}

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

/** run 是否为摘要 run（内容级标记，跨重启幂等） */
function isSummaryRun(run: RunContext): boolean {
  return run.messages.some((m) => m.content.includes(SUMMARY_MARKER));
}

function isOmittedToolResult(content: string): boolean {
  return content.startsWith(OMITTED_TOOL_RESULT_PREFIX);
}

/** ```novel 块 → [正文已入档：首行摘要]（正式稿为准） */
function replaceNovelBlocks(text: string): string {
  if (!text.includes("```novel")) return text;
  return text.replace(/```novel[^\n]*\n?([\s\S]*?)```/g, (_match, body: string) => {
    const firstLine =
      String(body)
        .split("\n")
        .find((line) => line.trim().length > 0) ?? "";
    const label = firstLine.trim().slice(0, 24) || "正文";
    return `${ARCHIVED_NOVEL_PREFIX}：${label}]`;
  });
}

/** assistant 长评述头尾截断（保结论与收尾） */
function trimAssistantText(text: string): string {
  if (text.length <= ASSISTANT_TEXT_TRIM_CHARS) return text;
  const omitted = text.length - ASSISTANT_TEXT_KEEP_HEAD - ASSISTANT_TEXT_KEEP_TAIL;
  return `${text.slice(0, ASSISTANT_TEXT_KEEP_HEAD)}\n……（已省略 ${omitted} 字）……\n${text.slice(-ASSISTANT_TEXT_KEEP_TAIL)}`;
}

/**
 * 自动上下文压缩策略（主 agent 装配；见文件头注释）
 */
export class AutoCompactPolicy implements ContextCompactPolicy {
  private readonly provider: Provider;
  private readonly t1Ratio: number;
  private readonly t2MarginTokens: number;
  private readonly t2CapRatio: number;
  private readonly summarySegmentTokens: number;
  private readonly summaryMaxTokens: number;
  private readonly keepFirst: number;
  private readonly keepLast: number;
  private readonly windowTokensOf: (model: string) => number;
  private readonly logger?: Logger;

  constructor(provider: Provider, opts: AutoCompactOptions = {}) {
    this.provider = provider;
    this.t1Ratio = opts.t1Ratio ?? 0.7;
    this.t2MarginTokens = opts.t2MarginTokens ?? 12_000;
    this.t2CapRatio = opts.t2CapRatio ?? 0.92;
    this.summarySegmentTokens = opts.summarySegmentTokens ?? 40_000;
    this.summaryMaxTokens = opts.summaryMaxTokens ?? 2_048;
    this.keepFirst = opts.keepFirst ?? 1;
    this.keepLast = opts.keepLast ?? 3;
    this.windowTokensOf =
      opts.windowTokensOf ??
      ((model) => {
        const info = provider.getModelInfo(model);
        return info.contextWindowTokens ?? WINDOW_FALLBACK;
      });
    this.logger = opts.logger;
  }

  /** 是否需要压缩：阈值已到且仍有可做的工作（T1 可剪 / T2 可折 / T3 可丢） */
  shouldCompact(loop: LoopContext): boolean {
    const m = this.measure(loop);
    if (m.window === undefined) {
      this.logger?.debug("compact.evaluated", { decision: "no_signal", runs: loop.runs.length });
      return false;
    }
    if (m.est < m.t1) {
      this.logger?.debug("compact.evaluated", {
        decision: "below_t1",
        est: m.est,
        t1: m.t1,
        runs: loop.runs.length,
      });
      return false;
    }
    const work = this.hasWork(loop, m);
    this.logger?.debug("compact.evaluated", {
      decision: work ? "trigger" : "no_work",
      model: m.model,
      est: m.est,
      t1: m.t1,
      t2: m.t2,
      t3: m.t3,
      runs: loop.runs.length,
    });
    return work;
  }

  /**
   * 执行压缩：T1 → T2 → T3 顺序（每级动作后重估算）。
   * force 模式（保险丝）跳过 T1 阈值门且 T2 可连续折叠多段。
   * @returns 是否有任何一级实际压缩
   */
  async compact(loop: LoopContext, opts?: { force?: boolean }): Promise<boolean> {
    const force = opts?.force === true;
    const m = this.measure(loop);
    if (m.window === undefined) return false;
    if (!force && m.est < m.t1) return false;

    // 触发日志：本次压缩的完整决策快照（谁触发 / 窗口多大 / 估算多少 / 三线在哪）
    this.logger?.info("compact.trigger", {
      force,
      model: m.model,
      window: m.window,
      est: m.est,
      t1: m.t1,
      t2: m.t2,
      t3: m.t3,
      runs: loop.runs.length,
    });

    let changed = false;
    // T1 结构化骨架化（压缩区；force 时也照常执行）
    const zoneRuns = this.zoneOf(loop);
    if (zoneRuns !== undefined && zoneRuns.length > 0) {
      const meta = this.scanNovelMeta(loop);
      if (this.skeletonize(zoneRuns, meta)) {
        changed = true;
        this.logger?.info("compact.t1.skeletonized", {
          runs: zoneRuns.length,
          estAfter: this.measure(loop).est,
        });
      }
    }
    // T2 逐段摘要折叠（内部按 T2 线判断；常规一次一段）
    if (await this.foldSummaries(loop, force)) changed = true;
    // T3 硬丢弃（危险线；从最老开始，首 run 最后）
    if (this.hardDrop(loop)) changed = true;
    const estAfter = this.measure(loop).est;
    this.logger?.info("compact.done", {
      changed,
      estAfter,
      runsAfter: loop.runs.length,
    });
    return changed;
  }

  // ── 度量与阈值线 ──

  /** 当前占用度量 + 三条阈值线（无模型信号时 window 为 undefined，策略不动作） */
  private measure(loop: LoopContext): Measure {
    const runs = loop.runs;
    const signal = scanLastSignal(runs);
    const charsNow = countRunChars(runs);
    // 占用估算：信号 × (当前字符 / 信号时字符)——压缩（折叠/骨架化/丢弃）后按比例收敛，
    // 而不是永远沿用压缩前的信号值；无 signalChars 的旧数据退化为直接用信号
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
    const window = this.windowTokensOf(signal.model);
    const maxOutput = signal.maxOutputTokens ?? MAX_OUTPUT_FALLBACK;
    const t1 = Math.floor(window * this.t1Ratio);
    const t2 = Math.min(window - maxOutput - this.t2MarginTokens, Math.floor(window * this.t2CapRatio));
    const t3 = window - Math.floor(maxOutput / 2);
    return { model: signal.model, window, est, t1, t2, t3 };
  }

  /** 是否仍有可做的工作（shouldCompact 判定；全部同步检查） */
  private hasWork(loop: LoopContext, m: Measure): boolean {
    const runs = loop.runs;
    if (runs.length <= this.keepFirst + this.keepLast) return false;
    if (m.est >= m.t3) return true;
    const zone = this.zoneOf(loop);
    if (m.est >= m.t2 && zone !== undefined && zone.some((r) => !isSummaryRun(r))) return true;
    const meta = this.scanNovelMeta(loop);
    return this.structuralWorkCount(zone ?? [], meta) > 0;
  }

  /** 压缩区 runs（首 keepFirst 与尾 keepLast 之外；不足返回 undefined） */
  private zoneOf(loop: LoopContext): RunContext[] | undefined {
    const runs = loop.runs;
    if (runs.length <= this.keepFirst + this.keepLast) return undefined;
    return runs.slice(this.keepFirst, runs.length - this.keepLast);
  }

  // ── novel 域元数据扫描 ──

  /**
   * 扫描压缩区 + 保留尾区的 novel 工具调用（时序位置 = 消息序号）：
   * 保留尾区的后续写入同样使压缩区内的早期读/写过期。
   */
  private scanNovelMeta(loop: LoopContext): NovelCallMeta {
    const runs = loop.runs;
    const calls = new Map<
      string,
      { kind: "read" | "write"; name: string; entityIds: Set<string>; pos: number }
    >();
    const lastWrite = new Map<string, { pos: number; callId: string }>();
    let pos = 0;
    for (let i = this.keepFirst; i < runs.length; i++) {
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

  // ── T1 结构化骨架化 ──

  /** T1 可剪项计数（幂等检测：已占位的不计） */
  private structuralWorkCount(zone: readonly RunContext[], meta: NovelCallMeta): number {
    let count = 0;
    for (const run of zone) {
      for (const msg of run.messages) {
        if (msg.role === "tool" && !isOmittedToolResult(msg.content)) {
          if (this.toolResultSuperseded(msg.id, msg.content, meta)) count++;
          else if (msg.content.length > TOOL_RESULT_PLACEHOLDER_CHARS) count++;
        } else if (msg.role === "assistant") {
          for (const tc of msg.toolCalls ?? []) {
            if (tc.args.includes(COMPACTED_ARGS_MARK)) continue;
            const call = meta.calls.get(tc.id);
            if (call?.kind === "write" && call.entityIds.size > 0) {
              const isLastForSome = [...call.entityIds].some(
                (id) => meta.lastWrite.get(id)?.callId === tc.id,
              );
              if (!isLastForSome || tc.args.length > TOOL_ARGS_PLACEHOLDER_CHARS) count++;
            } else if (tc.args.length > TOOL_ARGS_PLACEHOLDER_CHARS) {
              count++;
            }
          }
          if (msg.content.includes("```novel") || msg.content.length > ASSISTANT_TEXT_TRIM_CHARS) {
            // 正文块或长评述（占位后长度已降，重复检测自然短路）
            const replaced = trimAssistantText(replaceNovelBlocks(msg.content));
            if (replaced !== msg.content) count++;
          }
        }
      }
    }
    return count;
  }

  /** tool 结果是否为"后写覆盖前读"的过期读（含结果已占位时的判定复用） */
  private toolResultSuperseded(
    callId: string,
    content: string,
    meta: NovelCallMeta,
  ): boolean {
    if (isOmittedToolResult(content)) return false;
    const call = meta.calls.get(callId);
    if (call?.kind !== "read" || call.entityIds.size === 0) return false;
    return [...call.entityIds].some((id) => {
      const lw = meta.lastWrite.get(id);
      return lw !== undefined && lw.pos >= call.pos;
    });
  }

  /** T1 骨架化执行（原地改写压缩区消息；返回是否有变化） */
  private skeletonize(zone: readonly RunContext[], meta: NovelCallMeta): boolean {
    let changed = false;
    for (const run of zone) {
      for (const msg of run.messages) {
        if (msg.role === "tool") {
          if (isOmittedToolResult(msg.content)) continue;
          const name = meta.calls.get(msg.id)?.name;
          if (this.toolResultSuperseded(msg.id, msg.content, meta)) {
            msg.content = `${OMITTED_TOOL_RESULT_PREFIX}：该实体的读取已被后续写入覆盖，请重新查询最新版]`;
            changed = true;
          } else if (msg.content.length > TOOL_RESULT_PLACEHOLDER_CHARS) {
            const label = name !== undefined ? `${name} 结果` : "结果";
            msg.content = `${OMITTED_TOOL_RESULT_PREFIX}：${label}（原 ${msg.content.length} 字）]`;
            changed = true;
          }
        } else if (msg.role === "assistant") {
          for (const tc of msg.toolCalls ?? []) {
            if (tc.args.includes(COMPACTED_ARGS_MARK)) continue;
            const call = meta.calls.get(tc.id);
            if (call?.kind === "write" && call.entityIds.size > 0) {
              const isLastForSome = [...call.entityIds].some(
                (id) => meta.lastWrite.get(id)?.callId === tc.id,
              );
              if (!isLastForSome) {
                // 全部目标实体都被更晚写入覆盖 → 整调用占位（保留 id/name 维持配对）
                tc.args = COMPACTED_ARGS_COVERED;
                changed = true;
              } else if (tc.args.length > TOOL_ARGS_PLACEHOLDER_CHARS) {
                // 最后一次写入：保留调用记录，超大内容参数占位（正式稿为准）；
                // 占位携带结构化 ids——后续扫描轮次仍可据此做 lastWrite 跟踪
                const ids = [...call.entityIds].slice(0, 16);
                tc.args = JSON.stringify({ _compacted: "写入内容已入正式稿", ids });
                changed = true;
              }
            } else if (tc.args.length > TOOL_ARGS_PLACEHOLDER_CHARS) {
              // 非 novel 工具的超长参数同样占位（通用规则）
              tc.args = `{"_compacted":"超长参数已省略（原 ${tc.args.length} 字）"}`;
              changed = true;
            }
          }
          const replaced = trimAssistantText(replaceNovelBlocks(msg.content));
          if (replaced !== msg.content) {
            msg.content = replaced;
            changed = true;
          }
        }
      }
    }
    return changed;
  }

  // ── T2 逐段摘要折叠 ──

  /**
   * 折叠最老未摘要段为一条摘要 run（常规一次一段，force 连续折叠至低于 T2 线）。
   * 防失真不变量：摘要 run 只增不并，永不进入折叠段。
   * @returns 是否发生折叠
   */
  private async foldSummaries(loop: LoopContext, force: boolean): Promise<boolean> {
    let folded = false;
    const maxSegments = force ? 20 : 1;
    for (let s = 0; s < maxSegments; s++) {
      const m = this.measure(loop);
      if (m.model === undefined || m.est < m.t2) break;
      const runs = loop.runs;
      const firstIdx = this.keepFirst;
      const lastExclusive = runs.length - this.keepLast;
      if (lastExclusive <= firstIdx) break;
      // 从最老开始收集连续非摘要 run（跳过头部既有摘要 run）直到预算
      const segment: RunContext[] = [];
      let acc = 0;
      for (let i = firstIdx; i < lastExclusive; i++) {
        const r = runs[i]!;
        if (isSummaryRun(r)) {
          if (segment.length > 0) break;
          continue;
        }
        segment.push(r);
        acc += estimateTokens(r.messages);
        if (acc >= this.summarySegmentTokens) break;
      }
      if (segment.length === 0) break;
      const segChars = countRunChars(segment);
      // 段比摘要本身还小时折叠得不偿失（est 反升可能误触 T3）：压力来自保留区，交给 T3
      if (segChars < MIN_FOLD_CHARS) break;
      const firstSeq = segment[0]!.seq;
      const lastSeq = segment[segment.length - 1]!.seq;
      const summaryText = await this.summarize(segment, m);
      const summaryRun = makeSummaryRun(loop.allocateSeq(), summaryText, firstSeq, lastSeq);
      const start = runs.indexOf(segment[0]!);
      runs.splice(start, segment.length, summaryRun);
      folded = true;
      this.logger?.info("compact.t2.folded", {
        runs: segment.length,
        firstSeq,
        lastSeq,
        summarySeq: summaryRun.seq,
      });
      if (!force) break;
    }
    return folded;
  }

  /**
   * 生成摘要（会话当前主模型，无工具、低输出上限）；失败降级为确定性占位
   * （压缩仍发生，信息全失但不阻断——保险丝语义）
   */
  private async summarize(segment: readonly RunContext[], m: Measure): Promise<string> {
    const messages = segment.flatMap((r) => r.messages);
    const model = m.model!;
    try {
      const call: ProviderCall = {
        system: SUMMARY_SYSTEM_PROMPT,
        tools: [],
        messages,
        sampling: { model, maxTokens: this.summaryMaxTokens, thinking: "off" },
      };
      const result = await this.provider.call(call);
      const text = result.message.content.trim();
      if (text.length > 0) return text;
    } catch (err) {
      this.logger?.warn("compact.summary_failed", {
        error: err instanceof Error ? err.constructor.name : String(err),
      });
    }
    return `（摘要生成失败，降级占位：本段共 ${messages.length} 条消息；关键内容请用查询工具从正式稿获取）`;
  }

  // ── T3 硬丢弃 ──

  /**
   * 危险线（est ≥ window − maxOutput/2）硬丢弃：压缩区最老开始（含旧摘要 run），
   * 首 run（作者意图）最后；逐 run 丢弃并重估算。返回是否发生丢弃。
   */
  private hardDrop(loop: LoopContext): boolean {
    let m = this.measure(loop);
    if (m.window === undefined || m.est < m.t3) return false;
    const runs = loop.runs;
    // 丢弃顺序：压缩区（时序最老在前，含摘要 run）→ 首 run 兜底
    const candidates: RunContext[] = runs.slice(this.keepFirst, Math.max(this.keepFirst, runs.length - this.keepLast));
    const firstRun = runs[0];
    if (firstRun !== undefined && runs.length > this.keepLast) candidates.push(firstRun);
    let dropped = false;
    for (const run of candidates) {
      if (m.est < m.t3) break;
      const idx = runs.indexOf(run);
      if (idx < 0) continue;
      runs.splice(idx, 1);
      dropped = true;
      this.logger?.warn("compact.t3.dropped", { seq: run.seq });
      m = this.measure(loop);
    }
    return dropped;
  }
}

/** 构造摘要 run（user 角色合成消息 + 内容级标记；appendRunMessages 闭包持有数组） */
function makeSummaryRun(
  seq: number,
  summaryText: string,
  firstSeq: number,
  lastSeq: number,
): RunContext {
  const messages: LLMessage[] = [
    {
      role: "user",
      content: [
        SUMMARY_MARKER,
        `（第 ${firstSeq}–${lastSeq} 轮对话的压缩摘要，原文已因长度限制移除；实体详情可用查询工具从正式稿获取）`,
        summaryText,
        "</context-summary>",
      ].join("\n"),
    },
  ];
  return {
    seq,
    messages,
    ts: new Date().toISOString(),
    appendRunMessages: (m) => {
      messages.push(...m);
    },
  };
}
