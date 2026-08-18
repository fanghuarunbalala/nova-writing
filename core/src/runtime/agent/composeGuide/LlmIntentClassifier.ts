/**
 * LLM 意图分类器（PRD compose-案例引导 F5）：spawn 时对委派 prompt 单次调用，
 * **弃权语义**——不确定输出 unknown，任何失败（超时/异常/解析失败）返回
 * undefined，不重试、不做规则兜底（避免两套词表的循环验证问题）。
 * 标签枚举来自案例库扫描结果（与库内容一致，不硬编码词表）。
 * LLM intent classifier: a single call over the delegation prompt at spawn,
 * with an abstention-first contract — "unknown" when unsure; timeouts /
 * exceptions / parse failures all degrade to undefined. The tag catalog is
 * derived from the case library scan (no hardcoded vocabulary).
 */
import type { Provider } from "../../provider/Provider.js";
import type { ProviderCall, SamplingConfig } from "../../provider/types.js";
import type { GuideCaseEntry, IntentTags } from "./types.js";

/** 分类器构造选项 */
export interface LlmIntentClassifierOptions {
  /** 分类专用 provider 实例（Fast 档连接；宿主注入，tight timeout） */
  provider: Provider;
  /** 采样配置（宿主已收紧 maxTokens、关 thinking） */
  sampling: SamplingConfig;
}

/** 标签目录（从案例库条目派生） */
interface TagCatalog {
  taskTypes: Set<string>;
  characterTypes: Set<string>;
  situations: Set<string>;
}

function catalogOf(entries: readonly GuideCaseEntry[]): TagCatalog {
  const characterTypes = new Set<string>();
  const situations = new Set<string>();
  for (const e of entries) {
    if (e.characterType !== undefined) characterTypes.add(e.characterType);
    if (e.situation !== undefined) situations.add(e.situation);
  }
  return { taskTypes: new Set(entries.map((e) => e.taskType)), characterTypes, situations };
}

/** 分类指令（枚举 + 一句话定义 + 弃权规则） */
function classifySystemPrompt(catalog: TagCatalog): string {
  const lines = [
    "你是任务分类器。把给定的「委派需求」文本分类为以下标签。",
    "",
    `task_type（必选其一）：${[...catalog.taskTypes].join(" / ")}`,
  ];
  if (catalog.characterTypes.size > 0) {
    lines.push(`character_type（可选）：${[...catalog.characterTypes].join(" / ")}`);
  }
  if (catalog.situations.size > 0) {
    lines.push(`situation（可选）：${[...catalog.situations].join(" / ")}`);
  }
  lines.push(
    "",
    "只输出一个 JSON 对象，格式：{\"task_type\":\"...\",\"character_type\":\"...\",\"situation\":\"...\"}",
    "规则：值必须从上面的枚举中选择；不确定的字段输出 \"unknown\"；整体不确定就输出 {\"task_type\":\"unknown\"}；不要输出 JSON 以外的任何内容。",
  );
  return lines.join("\n");
}

/** 解析模型输出 → 标签（unknown/越界/坏 JSON → undefined 弃权） */
function parseTags(raw: string, catalog: TagCatalog): IntentTags | undefined {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const obj = parsed as Record<string, unknown>;
  const taskType = typeof obj.task_type === "string" ? obj.task_type.trim() : "";
  if (taskType === "" || taskType === "unknown" || !catalog.taskTypes.has(taskType)) {
    return undefined;
  }
  const pick = (key: string, allowed: Set<string>): string | undefined => {
    const value = typeof obj[key] === "string" ? (obj[key] as string).trim() : "";
    return value !== "" && value !== "unknown" && allowed.has(value) ? value : undefined;
  };
  const characterType = pick("character_type", catalog.characterTypes);
  const situation = pick("situation", catalog.situations);
  return {
    taskType,
    ...(characterType !== undefined ? { characterType } : {}),
    ...(situation !== undefined ? { situation } : {}),
  };
}

/** LLM 意图分类器（单次调用；宿主闭包保证只调一次） */
export class LlmIntentClassifier {
  private readonly provider: Provider;
  private readonly sampling: SamplingConfig;

  constructor(options: LlmIntentClassifierOptions) {
    this.provider = options.provider;
    this.sampling = options.sampling;
  }

  /**
   * 对委派 prompt 分类
   * @param prompt 委派 prompt 原文
   * @param entries 案例库条目（派生标签枚举）
   * @returns 标签；弃权/失败返回 undefined
   */
  async classify(prompt: string, entries: readonly GuideCaseEntry[]): Promise<IntentTags | undefined> {
    const catalog = catalogOf(entries);
    if (catalog.taskTypes.size === 0) return undefined;
    const call: ProviderCall = {
      system: classifySystemPrompt(catalog),
      tools: [],
      messages: [{ role: "user", content: prompt }],
      sampling: this.sampling,
    };
    let result;
    try {
      result = await this.provider.call(call);
    } catch {
      return undefined;
    }
    return parseTags(result.message.content, catalog);
  }
}
