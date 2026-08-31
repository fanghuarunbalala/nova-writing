/**
 * 记忆检索词法层（PRD memory-两层记忆 §4.5 修订：BM25 取代 3/2/1 打分）：
 * CJK bigram + 拉丁词分词（零依赖，不引 jieba），字段加权 BM25（k1=1.5/b=0.75，
 * name×2 + description×1，字段各自统计 avgdl/df）。语料 = 全部记忆条目，查询时
 * 现算（几十条量级无需持久索引）；同分按 name 字典序保确定性。
 */
/** CJK 表意文字（含扩展 A/兼容区） */
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
/** CJK 连续段提取 */
const CJK_RUN_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g;
/** 拉丁/数字词（含连字符拼接词整体后按 - 再切） */
const LATIN_RUN_RE = /[a-z0-9]+(?:-[a-z0-9]+)*/g;

/**
 * 分词：拉丁词（小写化，连字符词再拆分）+ CJK bigram（单字段退 unigram）。
 * 例："打斗场面 pov-preference" → ["打斗","斗场","场面","pov","preference"]
 * @param text 输入文本
 * @returns token 列表（可含重复，词袋语义）
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const lower = text.toLowerCase();
  for (const run of lower.match(LATIN_RUN_RE) ?? []) {
    for (const part of run.split("-")) {
      if (part.length > 0) tokens.push(part);
    }
  }
  for (const run of lower.match(CJK_RUN_RE) ?? []) {
    if (run.length === 1) {
      tokens.push(run);
      continue;
    }
    for (let i = 0; i + 1 < run.length; i++) {
      tokens.push(run.slice(i, i + 2));
    }
    // 尾字孤悬时补 unigram（"人称偏好"长 4→bigram 全覆盖；长 5 末字补单字）
    if (run.length % 2 === 1 && run.length > 2) tokens.push(run.at(-1) as string);
  }
  return tokens;
}

/** 是否含 CJK 字符（跳过纯拉丁快速路径用） */
export function containsCjk(text: string): boolean {
  return CJK_RE.test(text);
}

/** BM25 文档（两字段） */
export interface BM25Doc {
  /** 文档唯一键（同分排序用） */
  readonly key: string;
  /** 字段一：名称（权重高） */
  readonly name: string;
  /** 字段二：描述 */
  readonly description: string;
}

/** BM25 参数（Robertson-Sparck Jones 惯例缺省） */
export interface BM25Options {
  readonly k1?: number;
  readonly b?: number;
  /** name 字段权重（缺省 2） */
  readonly nameWeight?: number;
}

interface FieldStats {
  /** 每词文档频率（含重复计数语义：一篇出现多次记 1） */
  df: Map<string, number>;
  /** 平均字段长 */
  avgdl: number;
}

/** 单字段语料统计 */
function fieldStats(fieldTexts: readonly string[]): FieldStats {
  const df = new Map<string, number>();
  let totalLen = 0;
  for (const text of fieldTexts) {
    const seen = new Set<string>();
    for (const token of tokenize(text)) seen.add(token);
    for (const token of seen) df.set(token, (df.get(token) ?? 0) + 1);
    totalLen += tokenize(text).length;
  }
  return { df, avgdl: fieldTexts.length === 0 ? 0 : totalLen / fieldTexts.length };
}

/** 单字段 BM25 得分 */
function fieldScore(
  queryTokens: readonly string[],
  fieldText: string,
  stats: FieldStats,
  N: number,
  k1: number,
  b: number,
): number {
  if (queryTokens.length === 0) return 0;
  const tf = new Map<string, number>();
  let dl = 0;
  for (const token of tokenize(fieldText)) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
    dl++;
  }
  let score = 0;
  const seen = new Set<string>();
  for (const token of queryTokens) {
    if (seen.has(token)) continue; // 查询内重复词去重（防同词多计）
    seen.add(token);
    const f = stats.df.get(token);
    if (f === undefined || f === 0) continue;
    const idf = Math.log(1 + (N - f + 0.5) / (f + 0.5));
    const freq = tf.get(token) ?? 0;
    if (freq === 0) continue;
    const denom = freq + k1 * (1 - b + (b * dl) / (stats.avgdl === 0 ? 1 : stats.avgdl));
    score += idf * ((freq * (k1 + 1)) / denom);
  }
  return score;
}

/**
 * 字段加权 BM25 排序：score = nameWeight·bm25(name) + bm25(description)；
 * 同分按 key 字典序（确定性）。
 * @param docs 语料（全部候选条目）
 * @param query 查询文本
 * @param options k1/b/nameWeight
 * @returns [{key, score}] 分数>0，按分降序
 */
export function bm25Rank(
  docs: readonly BM25Doc[],
  query: string,
  options?: BM25Options,
): { key: string; score: number }[] {
  const k1 = options?.k1 ?? 1.5;
  const b = options?.b ?? 0.75;
  const nameWeight = options?.nameWeight ?? 2;
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0 || docs.length === 0) return [];
  const N = docs.length;
  const nameStats = fieldStats(docs.map((d) => d.name));
  const descStats = fieldStats(docs.map((d) => d.description));
  return docs
    .map((doc) => ({
      key: doc.key,
      score:
        nameWeight * fieldScore(queryTokens, doc.name, nameStats, N, k1, b) +
        fieldScore(queryTokens, doc.description, descStats, N, k1, b),
    }))
    .filter((r) => r.score > 0)
    .sort((a, c) => (c.score - a.score !== 0 ? c.score - a.score : a.key < c.key ? -1 : a.key > c.key ? 1 : 0));
}
