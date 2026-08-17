import type { AssistantMessage, LLMessage, ToolCall } from "../provider/types.js";

/**
 * tool result 序列守卫：保证发给 provider 的 messages 满足 tool-call 协议——
 * 每个 assistant(toolCalls) 消息之后必须紧跟其全部 tool result（按 toolCalls 顺序），
 * 中间不得插入 user 等其他消息（OpenAI/Anthropic 兼容端点对违反序列直接 400）。
 *
 * 已知成因：工具挂起（如 AskUserQuestion 等用户作答）期间用户追发新消息开新 run，
 * tool result 追加到末尾 run，落在插入的 user 消息之后。本守卫在 toProviderCall 组装
 * payload 时把错位的 tool result 前移回所属 assistant 紧后，其余消息保持相对顺序——
 * 不改 journal 存量数据，坏会话 hydrate 后第一次 call 即自愈。
 * 合法序列原样返回同一引用（常规路径零分配）；缺失 tool result 的不补不报
 * （resumePendingRun 补完逻辑的职责），只修「result 存在但被隔断」的错位。
 * @param messages 平铺消息序列
 * @returns 满足协议的消息序列（合法时为入参原引用）
 */
export function reorderToolResults(messages: LLMessage[]): LLMessage[] {
  const toolIndexById = indexToolResults(messages);
  return hasMisorderedToolResult(messages, toolIndexById) ? repair(messages, toolIndexById) : messages;
}

/** assistant 消息且携带 toolCalls（检测/重排共用的类型守卫） */
function isAssistantWithToolCalls(m: LLMessage): m is AssistantMessage & { toolCalls: ToolCall[] } {
  return m.role === "assistant" && m.toolCalls !== undefined && m.toolCalls.length > 0;
}

/** tool result 索引表：id → 消息位置（id 重复时取首个；toolCallId 语义上全局唯一） */
function indexToolResults(messages: LLMessage[]): Map<string, number> {
  const index = new Map<string, number>();
  messages.forEach((m, i) => {
    if (m.role === "tool" && !index.has(m.id)) index.set(m.id, i);
  });
  return index;
}

/**
 * 检测序列是否存在「result 存在但被隔断」的错位：assistant(toolCalls) 与其 result
 * 之间出现其他消息，且被隔断的 result 确实在后续存在（纯缺失不触发，留给补完逻辑）
 */
function hasMisorderedToolResult(messages: LLMessage[], toolIndexById: Map<string, number>): boolean {
  /** 当前 assistant(toolCalls) 尚未见到的 result id */
  let pending: string[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m === undefined) continue;
    if (isAssistantWithToolCalls(m)) {
      if (hasRelocatableResult(pending, toolIndexById, i)) return true;
      pending = m.toolCalls.map((tc) => tc.id);
    } else if (m.role === "tool") {
      const j = pending.indexOf(m.id);
      if (j >= 0) pending.splice(j, 1);
    } else if (pending.length > 0 && hasRelocatableResult(pending, toolIndexById, i)) {
      // assistant(toolCalls) 与其 result 之间出现 user/system 等隔断消息
      return true;
    }
  }
  return false;
}

/** pending 中是否有 result 出现在位置 pos 之后（可前移归位） */
function hasRelocatableResult(pending: string[], toolIndexById: Map<string, number>, pos: number): boolean {
  return pending.some((id) => (toolIndexById.get(id) ?? -1) > pos);
}

/** 重排：错位的 tool result 前移到所属 assistant 紧后（按 toolCalls 顺序；assistant 之前出现的不动） */
function repair(messages: LLMessage[], toolIndexById: Map<string, number>): LLMessage[] {
  /** 已被前移消费的 tool result（原位置跳过） */
  const consumed = new Set<string>();
  const out: LLMessage[] = [];
  messages.forEach((m, i) => {
    if (m.role === "tool" && consumed.has(m.id)) return;
    out.push(m);
    if (!isAssistantWithToolCalls(m)) return;
    for (const tc of m.toolCalls) {
      const toolAt = toolIndexById.get(tc.id);
      // 缺 result / 出现在 assistant 之前：不动
      if (toolAt === undefined || toolAt <= i) continue;
      const result = messages[toolAt];
      if (result === undefined || result.role !== "tool") continue;
      consumed.add(result.id);
      out.push(result);
    }
  });
  return out;
}
