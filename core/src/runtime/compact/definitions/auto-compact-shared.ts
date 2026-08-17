/**
 * auto-compact 共享常量与类型（docs/PRD/context-compact.md）：
 * 三道门禁（t1-skeletonize / t2-fold / t3-drop）与分析模块（auto-compact-analyze）
 * 共用的阈值、占位文案标记与数据结构。占位前缀即幂等检测标记（跨压缩轮次/跨重启）。
 */
import type { Provider } from "../../provider/Provider.js";
import type { Logger } from "../../../log/Logger.js";

// ── 占位文案（前缀即幂等检测标记） ──

export const OMITTED_TOOL_RESULT_PREFIX = "[工具结果已省略";
export const ARCHIVED_NOVEL_PREFIX = "[正文已入档";
export const COMPACTED_ARGS_MARK = '"_compacted"';
export const COMPACTED_ARGS_COVERED = '{"_compacted":"该写入已被后续写入覆盖，正式稿以最后一次为准"}';
export const SUMMARY_MARKER = "<context-summary>";

// ── T1 长度阈值 ──

/** 工具结果超过该字符数替换为一行占位 */
export const TOOL_RESULT_PLACEHOLDER_CHARS = 500;
/** 工具参数超过该字符数视为超长（写入内容以正式稿为准） */
export const TOOL_ARGS_PLACEHOLDER_CHARS = 800;
/** assistant 评述（去正文块后）超过该字符数做头尾截断 */
export const ASSISTANT_TEXT_TRIM_CHARS = 1000;
export const ASSISTANT_TEXT_KEEP_HEAD = 400;
export const ASSISTANT_TEXT_KEEP_TAIL = 200;

// ── T2 段预算 ──

/** 最小折叠段字符量：段比摘要本身还小时折叠得不偿失（est 反升），压力交给 T3 */
export const MIN_FOLD_CHARS = 1_000;

// ── 估算兜底 ──

/** 字符 → token 估算比例（中文为主保守取 2 字/token；有信号时按比例重估替代） */
export const CHARS_PER_TOKEN_FALLBACK = 2;
/** 无信号时的校准兜底（含 system/tools 开销的粗放大） */
export const CALIB_FALLBACK = 1.5;
/** 信号缺失时 maxOutput 兜底 */
export const MAX_OUTPUT_FALLBACK = 8192;
/** 窗口查询失败兜底 */
export const WINDOW_FALLBACK = 128_000;

/** novel 工具调用元数据（结构化压缩域规则的判定依据） */
export interface NovelCallMeta {
  /** 消息位置计数基准上的调用表：toolCallId → { kind, name, entityIds, pos } */
  calls: Map<
    string,
    { kind: "read" | "write"; name: string; entityIds: Set<string>; pos: number }
  >;
  /** 实体 id → 最后一次写入（位置 + callId） */
  lastWrite: Map<string, { pos: number; callId: string }>;
}

/** 占用度量：阈值线 + 估算 */
export interface Measure {
  model?: string;
  window?: number;
  /** 当前占用估算（信号 × 字符比例；无信号按字符×保守系数） */
  est: number;
  t1: number;
  t2: number;
  t3: number;
}

/** 策略解析后的完整配置（构造时由 AutoCompactOptions 解析；各门禁模块共用） */
export interface AutoCompactConfig {
  /** 摘要调用的 provider（会话当前主模型） */
  provider: Provider;
  /** T1 触发比例（0.7） */
  t1Ratio: number;
  /** T2 余量 token：T2 线 = window − maxOutput − 余量 */
  t2MarginTokens: number;
  /** T2 线上限比例（0.92） */
  t2CapRatio: number;
  /** 摘要段输入 token 预算（每次触发折一段） */
  summarySegmentTokens: number;
  /** 摘要输出上限 token */
  summaryMaxTokens: number;
  /** 保留首部 run 数（作者意图） */
  keepFirst: number;
  /** 保留尾部 run 数（执行中 run 恒在其中） */
  keepLast: number;
  /** 窗口查询（model → context window tokens） */
  windowTokensOf: (model: string) => number;
  /** 结构化日志（可选） */
  logger?: Logger;
}
