/**
 * 流内 system 提醒的 wire 形态包装。
 *
 * LLMessage 的 system 角色用于会话中段注入的运行时通知（nudge/steer 等），
 * 但各厂商协议对中段 system 的态度不一（OpenAI 兼容端点透传、Anthropic 直接
 * 不允许），且以 system 权威承载可被外部内容影响的文本是提示注入的典型载体
 * 形态。适配层统一把流内 system 渲染为 user 角色 + 标签包裹：模型可辨识来源，
 * 携带的文本不再继承 system 权威。静态 system 提示词（call.system）不经过本包装。
 */

/** 提醒块开标签 */
export const SYSTEM_REMINDER_OPEN_TAG = "<system-reminder>";

/** 提醒块闭标签 */
export const SYSTEM_REMINDER_CLOSE_TAG = "</system-reminder>";

/**
 * 流内 system 内容 → 标签包裹文本（适配器消息转译用）
 * @param content 原始提醒内容
 * @returns `<system-reminder>` 包裹后的文本
 */
export function wrapSystemReminder(content: string): string {
	return `${SYSTEM_REMINDER_OPEN_TAG}\n${content}\n${SYSTEM_REMINDER_CLOSE_TAG}`;
}
