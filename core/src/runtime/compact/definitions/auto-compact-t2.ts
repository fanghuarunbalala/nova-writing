/**
 * T2 逐段摘要折叠（docs/PRD/context-compact.md §5）：折叠最老未摘要段为一条摘要 run。
 * 防失真三不变量：摘要 run 只增不并（永不合并旧摘要、永不再摘要已摘要内容）；
 * 摘要内容携带实体引用可回查正式稿；检测靠 <context-summary> 内容级标记（跨重启幂等）。
 * 摘要请求走会话当前主模型（无工具、thinking off、低输出上限）；失败降级为确定性占位。
 */
import type { LoopContext } from "../../loop/LoopContext.js";
import type { RunContext } from "../../loop/types.js";
import type { LLMessage, ProviderCall } from "../../provider/types.js";
import {
  MIN_FOLD_CHARS,
  SUMMARY_MARKER,
  type AutoCompactConfig,
  type Measure,
} from "./auto-compact-shared.js";
import { countRunChars, estimateTokens, isSummaryRun, measure } from "./auto-compact-analyze.js";

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

/**
 * 折叠最老未摘要段为一条摘要 run（常规一次一段，force 连续折叠至低于 T2 线）。
 * @returns 是否发生折叠
 */
export async function foldSummaries(
  loop: LoopContext,
  cfg: AutoCompactConfig,
  force: boolean,
): Promise<boolean> {
  let folded = false;
  const maxSegments = force ? 20 : 1;
  for (let s = 0; s < maxSegments; s++) {
    const m = measure(loop, cfg);
    if (m.model === undefined || m.est < m.t2) break;
    const runs = loop.runs;
    const firstIdx = cfg.keepFirst;
    const lastExclusive = runs.length - cfg.keepLast;
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
      if (acc >= cfg.summarySegmentTokens) break;
    }
    if (segment.length === 0) break;
    const segChars = countRunChars(segment);
    // 段比摘要本身还小时折叠得不偿失（est 反升可能误触 T3）：压力来自保留区，交给 T3
    if (segChars < MIN_FOLD_CHARS) break;
    const firstSeq = segment[0]!.seq;
    const lastSeq = segment[segment.length - 1]!.seq;
    const summaryText = await summarize(segment, m, cfg);
    const summaryRun = makeSummaryRun(loop.allocateSeq(), summaryText, firstSeq, lastSeq);
    const start = runs.indexOf(segment[0]!);
    runs.splice(start, segment.length, summaryRun);
    folded = true;
    cfg.logger?.info("compact.t2.folded", {
      runs: segment.length,
      firstSeq,
      lastSeq,
      summarySeq: summaryRun.seq,
    });
    if (!force) break;
  }
  return folded;
}

/** 生成摘要（会话当前主模型）；失败降级为确定性占位（压缩仍发生，信息全失但不阻断） */
async function summarize(
  segment: readonly RunContext[],
  m: Measure,
  cfg: AutoCompactConfig,
): Promise<string> {
  const messages = segment.flatMap((r) => r.messages);
  const model = m.model!;
  try {
    const call: ProviderCall = {
      system: SUMMARY_SYSTEM_PROMPT,
      tools: [],
      messages,
      sampling: { model, maxTokens: cfg.summaryMaxTokens, thinking: "off" },
    };
    const result = await cfg.provider.call(call);
    const text = result.message.content.trim();
    if (text.length > 0) return text;
  } catch (err) {
    cfg.logger?.warn("compact.summary_failed", {
      error: err instanceof Error ? err.constructor.name : String(err),
    });
  }
  return `（摘要生成失败，降级占位：本段共 ${messages.length} 条消息；关键内容请用查询工具从正式稿获取）`;
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
