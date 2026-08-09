/**
 * 会话级持久模式。Session-scoped persistent conversation mode.
 *
 * 三态:review(需审批,默认)/ bypass(直接执行)/ compose(设计模式)。
 * 该类型同时是 UI mode.set 输入、权限策略、reminder 渲染与持久化列的共同契约;
 * 加新模式(如 plan)只需扩展此 union + 各 switch 分支(见 PRD §6 扩展性)。
 */
export type ConversationMode = "review" | "bypass" | "compose";

export const DEFAULT_CONVERSATION_MODE: ConversationMode = "review";

/** 守卫:未知值是否为一个合法 mode。Guards a value as a valid conversation mode. */
export function isConversationMode(value: unknown): value is ConversationMode {
  return value === "review" || value === "bypass" || value === "compose";
}
