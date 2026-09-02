/**
 * 延迟工具注册表：MCP 等外部工具不常驻模型工具面（不进 toolSchemes / tool.policy
 * 名单），以本注册表承载——SearchExtraTools 发现、ExecuteExtraTool 执行、
 * external_tools nudge 公告名单。查询协议对齐
 * docs/reference/claude-code/tools/SearchExtraToolsTool.md：
 * - select:A,B —— 按名精确选择（逗号分隔多选，最快）；
 * - discover:关键词 —— 返回 name + description + parameters(JSON Schema)，仅查看不执行；
 * - 其余关键词 —— 打分排序（名称精确 > 名称包含 > 描述包含），max_results 截断。
 */
import type { ToolDef } from "../ToolDef.js";

/** 查询结果类别 */
export type DeferredToolSearchKind =
  | "selected" // select: 按名精确选择
  | "discovered" // discover: 关键词匹配 + 完整 schema
  | "matched" // 关键词匹配（仅名单）
  | "empty" // 注册表为空
  | "none"; // 无匹配

/** 单条搜索结果 */
export interface DeferredToolSearchItem {
  readonly name: string;
  readonly description?: string;
  /** discover: 附带完整参数 JSON Schema */
  readonly parameters?: Record<string, unknown>;
}

/** 搜索结果（text 为直出模型的文本；items 供调用方结构化取用） */
export interface DeferredToolSearchResult {
  readonly kind: DeferredToolSearchKind;
  readonly items: readonly DeferredToolSearchItem[];
  readonly text: string;
}

/** select: / discover: 查询前缀 */
const SELECT_PREFIX = "select:";
const DISCOVER_PREFIX = "discover:";

/** 无匹配统一文案（对齐 cc：不要断言能力不存在） */
const NO_MATCH_TEXT = "未找到匹配的延迟工具。不要断言能力不存在——换个关键词再试一次。";

/**
 * 关键词打分：查询按空白分词，逐词取「名称精确 3 > 名称包含 2 > 描述包含 1」后求和
 * （大小写不敏感）。多词查询（如 "slack send"）各词独立命中累加，无任何命中为 0。
 */
function scoreOf(tool: ToolDef, query: string): number {
  const name = tool.name.toLowerCase();
  const description = (tool.description ?? "").toLowerCase();
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
  let total = 0;
  for (const term of terms) {
    if (name === term) total += 3;
    else if (name.includes(term)) total += 2;
    else if (description.includes(term)) total += 1;
  }
  return total;
}

/** ExecuteExtraTool 调用引导句（选中名单以首个为例） */
function invokeHint(names: readonly string[]): string {
  const first = names[0] ?? "";
  return `用 ExecuteExtraTool 调用：{"tool_name": "${first}", "params": {...}}`;
}

/**
 * 延迟工具注册表（装配期定死，会话内不可变；构造自 MCP 包装 ToolDef[]）。
 * 条目保留原 def 的 requireApproval（受信=false、非受信=true），
 * ExecuteExtraTool 据此决定免审直执行或内嵌审批。
 */
export class DeferredToolRegistry {
  private readonly tools = new Map<string, ToolDef>();

  constructor(defs: readonly ToolDef[] = []) {
    for (const def of defs) {
      this.tools.set(def.name, def);
    }
  }

  /** 按名取工具定义 */
  get(name: string): ToolDef | undefined {
    return this.tools.get(name);
  }

  /** 全部工具定义（注册序，nudge 名单同序） */
  list(): ToolDef[] {
    return [...this.tools.values()];
  }

  /** 注册表大小 */
  get size(): number {
    return this.tools.size;
  }

  /**
   * 执行一次查询（select: / discover: / 关键词），返回结构化结果 + 直出文本。
   * @param query 查询串（trim 后判前缀）
   * @param maxResults 关键词/discover 最大返回条数（默认 5；下限 1）
   */
  search(query: string, maxResults = 5): DeferredToolSearchResult {
    const trimmed = query.trim();
    if (this.tools.size === 0) {
      return { kind: "empty", items: [], text: "当前没有延迟工具可用。" };
    }
    if (trimmed.startsWith(SELECT_PREFIX)) {
      return this.searchSelected(trimmed.slice(SELECT_PREFIX.length));
    }
    if (trimmed.startsWith(DISCOVER_PREFIX)) {
      return this.searchDiscovered(trimmed.slice(DISCOVER_PREFIX.length), maxResults);
    }
    return this.searchMatched(trimmed, maxResults);
  }

  /** select: 按名精确选择（逗号分隔多选）；未命中的名字逐一点名 */
  private searchSelected(namesText: string): DeferredToolSearchResult {
    const names = namesText
      .split(",")
      .map((n) => n.trim())
      .filter((n) => n.length > 0);
    if (names.length === 0) {
      return {
        kind: "none",
        items: [],
        text: "select: 需要至少一个工具名（如 select:工具名 或 select:A,B）。",
      };
    }
    const found: DeferredToolSearchItem[] = [];
    const missing: string[] = [];
    for (const name of names) {
      const tool = this.tools.get(name);
      if (tool === undefined) {
        missing.push(name);
      } else {
        found.push({ name: tool.name, description: tool.description });
      }
    }
    if (found.length === 0) {
      return {
        kind: "none",
        items: [],
        text: `未找到延迟工具: ${missing.join(", ")}。检查名称拼写，或用关键词搜索、discover: 查看。`,
      };
    }
    const lines = [`找到 ${found.length} 个延迟工具: ${found.map((f) => f.name).join(", ")}。`];
    if (missing.length > 0) {
      lines.push(`未找到: ${missing.join(", ")}。`);
    }
    lines.push(invokeHint(found.map((f) => f.name)));
    return { kind: "selected", items: found, text: lines.join("\n") };
  }

  /** discover: 关键词匹配后附完整描述与参数 schema（仅查看不执行） */
  private searchDiscovered(keyword: string, maxResults: number): DeferredToolSearchResult {
    const matches = this.matchByKeyword(keyword, maxResults);
    if (matches.length === 0) {
      return { kind: "none", items: [], text: NO_MATCH_TEXT };
    }
    const items: DeferredToolSearchItem[] = matches.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
    const parts = [`已发现 ${items.length} 个延迟工具（discover 仅查看，不执行）:`, ""];
    for (const item of items) {
      parts.push(`工具: ${item.name}`);
      if (item.description !== undefined && item.description.length > 0) {
        parts.push(`描述: ${item.description}`);
      }
      parts.push(`参数 schema: ${JSON.stringify(item.parameters ?? {})}`, "");
    }
    parts.push(invokeHint(items.map((i) => i.name)));
    return { kind: "discovered", items, text: parts.join("\n") };
  }

  /** 关键词搜索：打分排序 + max_results 截断，仅返回名单与引导 */
  private searchMatched(keyword: string, maxResults: number): DeferredToolSearchResult {
    const matches = this.matchByKeyword(keyword, maxResults);
    if (matches.length === 0) {
      return { kind: "none", items: [], text: NO_MATCH_TEXT };
    }
    const items: DeferredToolSearchItem[] = matches.map((tool) => ({
      name: tool.name,
      description: tool.description,
    }));
    const lines = [
      `找到 ${items.length} 个匹配的延迟工具: ${items.map((i) => i.name).join(", ")}。`,
      invokeHint(items.map((i) => i.name)),
      `discover:${keyword.trim()} 可查看匹配工具的完整参数 schema。`,
    ];
    return { kind: "matched", items, text: lines.join("\n") };
  }

  /** 关键词匹配（打分 > 0 的条目按分排序，同分按名字典序；空关键词无匹配） */
  private matchByKeyword(keyword: string, maxResults: number): ToolDef[] {
    const q = keyword.trim();
    if (q.length === 0) {
      return [];
    }
    const limit = Math.max(1, Math.floor(maxResults));
    return this.list()
      .map((tool) => ({ tool, score: scoreOf(tool, q) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || (a.tool.name < b.tool.name ? -1 : 1))
      .slice(0, limit)
      .map((s) => s.tool);
  }
}
