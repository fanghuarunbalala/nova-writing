/**
 * runtime.memory 工具组（PRD memory-两层记忆 M3）：MemoryWrite / MemorySearch /
 * MemoryForget。详情读取不设专用工具——主题文件是 workspace markdown，模型用
 * 现有 Read 直读（CC 同款 standard file tools）。
 *
 * source 由工具宿主自动附加（<会话id>#<run序号>，模型不可伪造不可手填——参数
 * schema 不含该字段）；skip 机械校验查两层 NOVEL.md 文本；同义/矛盾经索引重叠
 * 检查引导 update/supersede。MemoryWrite 默认免审批（低风险、可 Forget），
 * MemoryForget 强制审批（物理删除）。
 */
import type { ToolDef } from "../ToolDef.js";
import type { ToolCall } from "../../provider/types.js";
import { ToolError } from "../errors.js";
import {
  MEMORY_NAME_RE,
  findOverlappingEntry,
  forgetMemoryTopic,
  overlapsStaticLayer,
  searchMemoryTopics,
  writeMemoryTopic,
} from "../../../memory/MemoryStore.js";
import type { MemoryEntryType } from "../../../memory/MemoryStore.js";
import type { HybridSearchOptions } from "../../../memory/MemoryHybrid.js";

/** memory 工具组依赖 */
export interface MemoryToolsDeps {
  /** 工作区根（memory/ 所在地） */
  workspace: string;
  /** source 提供者：宿主闭包返回 `<会话id>#<run序号>`（模型不可传） */
  getSource: () => string;
  /** 两层 NOVEL.md 文本（skip 机械校验用；缺层 = undefined 占位） */
  staticLayerTexts: () => Promise<readonly (string | undefined)[]>;
  /** 混合检索选项（PRD D10：embedder/reranker；缺省纯 BM25 词法） */
  search?: HybridSearchOptions;
}

const MEMORY_TYPES: readonly MemoryEntryType[] = ["author", "feedback", "project", "reference"];

/** 路由/skip 指引（policy 行恒可见；guidance 进 tool.guidance 段） */
const MEMORY_WRITE_GUIDANCE = [
  "## 记忆写入路由（按序判定，先命中先路由）",
  "1. 作者明说的**跨书**规矩/口味 → 全局层 NOVEL.md（Write/Edit，强制审批）或建议作者手改；",
  "2. **本书**硬约束/世界观铁律/禁忌/字数/人称/文风 → 项目层 NOVEL.md（同上）；",
  "3. 从交互**学出来的**偏好/反馈/画像/项目经验，且两层 NOVEL.md、实体库、系统提示均无 → MemoryWrite；",
  "4. 角色/剧情/大纲/设定等**实体事实** → 实体库（NovelWrite/NovelEdit），不进记忆；",
  "5. 会话内临时状态（当前写哪章、刚讨论的草稿） → 不落层。",
  "**skip 规则（作者显式要求保存也适用）**：命中 1/2/4/5 的内容即使作者说「记住这个」也拒绝，回复中说明正确去处。",
  "**四类 type**：author=作者画像（水平/口味/阅读背景）；feedback=改稿反馈（纠正与肯定都记，附 Why 与 How to apply）；project=本项目决策与坑（实体库/journal 查不到的，相对日期转绝对日期）；reference=外部资源指针（只存去哪找）。",
  "**演化**：同义补充 → 同名 MemoryWrite 覆盖更新；改口矛盾 → 新 name + supersedes 指旧条目（旧条目自动 superseded）。",
  "**正文三段式**：`## 规则/事实` → `## Why` → `## How to apply`；单文件 ≤50 行，超限回执会提示拆分。",
].join("\n");

function parseToolArgs(call: ToolCall): Record<string, unknown> {
  try {
    return JSON.parse(call.args) as Record<string, unknown>;
  } catch {
    throw new ToolError(
      { code: "TOOL_ARGUMENTS_INVALID", toolName: call.name },
      `无效的 JSON 参数: ${call.args}`,
    );
  }
}

/**
 * 创建 memory 工具三件套
 * @param deps workspace + source 提供者 + 静态层文本提供者
 * @returns MemoryWrite / MemorySearch / MemoryForget
 */
export function createMemoryTools(deps: MemoryToolsDeps): ToolDef[] {
  const memoryWrite: ToolDef = {
    name: "MemoryWrite",
    version: "1.0.0",
    description:
      "写入一条跨会话记忆（动态学习层 memory/）。参数不含 source——出处由系统自动附加当前会话与轮次。\n\n用法：\n- name：kebab-case 主题名（如 pov-preference），一条可独立作废的规则/事实一个文件；禁止场景化命名。\n- type：author（作者画像）/ feedback（改稿反馈，纠正与肯定都记）/ project（本项目决策与坑）/ reference（外部资源指针）。\n- description：一句话，同时是检索锚点。\n- content：三段式正文（## 规则/事实 → ## Why → ## How to apply）。\n- supersedes：改口时指向被取代的旧条目名（可选）。\n- 已声明的静态约束/实体事实/临时状态不要写入（会被拒绝并提示正确去处）。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "主题名（kebab-case，= memory/<name>.md 文件名；一条可独立作废的规则/事实一个文件）" },
        type: { type: "string", enum: [...MEMORY_TYPES], description: "条目类型：author 作者画像 / feedback 改稿反馈 / project 本项目决策与坑 / reference 外部资源指针" },
        description: { type: "string", description: "一句话描述（≤120 字符，检索锚点与索引行）" },
        content: { type: "string", description: "三段式正文：## 规则/事实 → ## Why → ## How to apply（≤50 行）" },
        supersedes: { type: "string", description: "被本条目取代的旧条目名（改口场景；旧条目自动标 superseded 留盘可追溯）" },
      },
      required: ["name", "type", "description", "content"],
      additionalProperties: false,
    },
    promptDetail: {
      policy:
        "跨会话记忆只经 MemoryWrite 写入；NOVEL.md 静态约束与实体事实不进记忆（先查路由表）；改口用 supersedes。",
      guidance: MEMORY_WRITE_GUIDANCE,
    },
    handler: {
      execute: async (call) => {
        const args = parseToolArgs(call);
        const name = String(args.name ?? "");
        const type = String(args.type ?? "");
        const description = String(args.description ?? "").trim();
        const content = String(args.content ?? "");
        const supersedes =
          args.supersedes !== undefined ? String(args.supersedes) : undefined;
        if (!MEMORY_NAME_RE.test(name)) {
          throw new ToolError(
            { code: "TOOL_ARGUMENTS_INVALID", toolName: call.name },
            `name 必须是 kebab-case 主题名（如 pov-preference），收到: ${name}`,
          );
        }
        if (!MEMORY_TYPES.includes(type as MemoryEntryType)) {
          throw new ToolError(
            { code: "TOOL_ARGUMENTS_INVALID", toolName: call.name },
            `type 必须是 ${MEMORY_TYPES.join("/")}，收到: ${type}`,
          );
        }
        if (description.length === 0 || description.length > 120) {
          throw new ToolError(
            { code: "TOOL_ARGUMENTS_INVALID", toolName: call.name },
            "description 必填且 ≤120 字符（一句话，检索锚点）",
          );
        }
        if (content.trim().length === 0) {
          throw new ToolError(
            { code: "TOOL_ARGUMENTS_INVALID", toolName: call.name },
            "content 必填（三段式正文）",
          );
        }
        // skip 机械校验：两层 NOVEL.md 词法重叠（语义级判定靠 guidance 与 evals 兜底）
        const staticTexts = await deps.staticLayerTexts();
        const overlap = overlapsStaticLayer(description, content, staticTexts);
        if (overlap !== undefined) {
          return `已拒绝写入：该内容与 NOVEL.md 静态声明重叠（「${overlap.slice(0, 60)}」）。静态层已声明的约束不进动态记忆——若内容有演化，用 Write/Edit 修改 NOVEL.md（会请求作者审批）或建议作者手改。`;
        }
        // 同义检查：description 与既有条目互相包含 → 引导更新/supersede 而非新建
        if (supersedes === undefined) {
          const overlapping = await findOverlappingEntry(deps.workspace, name, description);
          if (overlapping !== undefined) {
            return `已拒绝新建：与既有条目 ${overlapping} 描述高度重叠。补充细化请用 name=${overlapping} 覆盖更新；改口矛盾请用新 name 并带 supersedes=${overlapping}。`;
          }
        }
        const source = deps.getSource();
        const receipt = await writeMemoryTopic(
          deps.workspace,
          { name, type: type as MemoryEntryType, description, content, ...(supersedes !== undefined ? { supersedes } : {}) },
          source,
        );
        const outcomeText =
          receipt.outcome === "created"
            ? `已新建记忆 ${name}（source=${source}）`
            : receipt.outcome === "updated"
              ? `已更新记忆 ${name}（保留原始 created/source，modified 刷新）`
              : `已新建记忆 ${name} 并取代旧条目 ${receipt.superseded}（旧条目标 superseded，留盘可追溯）`;
        const budgetText = receipt.indexOverflow
          ? `\n⚠ 索引已达 ${receipt.indexLines} 行（上限 200）：写入已成功，但请尽快整理——合并同义条目、将过时条目用 supersedes 收口。`
          : receipt.indexNearLimit
            ? `\n索引已达 ${receipt.indexLines} 行（阈值 180）：建议开始精简（合并同义、supersede 过时）。`
            : `\n索引当前 ${receipt.indexLines} 行。`;
        const bodyHint = receipt.bodyTooLong
          ? "\n提示：正文超过 50 行，建议按主题拆分为多个条目。"
          : "";
        return `${outcomeText}${budgetText}${bodyHint}`;
      },
    },
  };

  const memorySearch: ToolDef = {
    name: "MemorySearch",
    version: "1.0.0",
    description:
      "按关键词检索跨会话记忆（词法打分：名称精确 > 名称包含 > 描述包含；含已 superseded 条目）。\n\n用法：\n- query：空白分词的关键词（角色名、偏好主题、错误信息片段）。\n- max_results：默认 5。\n- 返回条目名 + 描述 + 状态；详情用 Read 读 memory/<name>.md。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "检索关键词（空白分词，可多个；匹配名称与描述）" },
        max_results: { type: "integer", description: "返回条数上限（默认 5）" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    promptDetail: {
      policy: "",
      guidance: "",
    },
    handler: {
      execute: async (call) => {
        const args = parseToolArgs(call);
        const query = String(args.query ?? "");
        const maxResults = typeof args.max_results === "number" ? args.max_results : 5;
        if (query.trim().length === 0) {
          throw new ToolError(
            { code: "TOOL_ARGUMENTS_INVALID", toolName: call.name },
            "query 必填",
          );
        }
        const results = await searchMemoryTopics(deps.workspace, query, maxResults, deps.search);
        if (results.length === 0) return "无匹配记忆条目。";
        return results
          .map(
            (r) =>
              `- ${r.name} — ${r.description}（${r.type}${r.status === "superseded" ? "，已 superseded" : ""}）`,
          )
          .join("\n");
      },
    },
  };

  const memoryForget: ToolDef = {
    name: "MemoryForget",
    version: "1.0.0",
    requireApproval: true,
    description:
      "删除一条跨会话记忆（物理删除 memory/<name>.md 并同步索引；需作者审批）。\n\n用法：\n- name：要遗忘的条目名。\n- reason：遗忘原因（审批呈现给作者）。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "要遗忘的条目名（kebab-case）" },
        reason: { type: "string", description: "遗忘原因（审批时呈现给作者）" },
      },
      required: ["name", "reason"],
      additionalProperties: false,
    },
    promptDetail: {
      policy: "",
      guidance: "",
    },
    handler: {
      execute: async (call) => {
        const args = parseToolArgs(call);
        const name = String(args.name ?? "");
        if (!MEMORY_NAME_RE.test(name)) {
          throw new ToolError(
            { code: "TOOL_ARGUMENTS_INVALID", toolName: call.name },
            `name 必须是 kebab-case 主题名，收到: ${name}`,
          );
        }
        const removed = await forgetMemoryTopic(deps.workspace, name);
        return removed ? `已删除记忆 ${name}` : `未找到记忆 ${name}（可能已不存在）`;
      },
    },
  };

  return [memoryWrite, memorySearch, memoryForget];
}
