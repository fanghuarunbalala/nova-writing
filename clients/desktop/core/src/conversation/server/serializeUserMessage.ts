/**
 * serializeUserMessage
 *
 * 用户消息引用序列化（PRD conversation-目录下钻与实体引用 F6）：
 * references 非空时序列化为 novel.system 声明的实体标签语法（成对写法带内文
 * 名称）追加到正文后，再交给 agent loop——journal 持久化（LLMessage 原文）、
 * 事件回放、ui 气泡 chips（parseMessageText）全部零额外改动，模型经标签 +
 * NovelRead 自取档案（F7：不注入）。
 */
import type { ConversationReference, ConversationUserMessage } from "../contract/types/message.js";

const REFERENCE_KINDS: readonly string[] = [
	"character",
	"location",
	"outline",
	"chapter",
	"paragraph",
];

/** 序列化用户消息正文：text + 引用标签块（无引用时原样返回）。 */
export function serializeUserMessageText(msg: ConversationUserMessage): string {
	const references = msg.references;
	if (references === undefined || references.length === 0) return msg.text;
	const tags = references
		.filter((ref): ref is ConversationReference => isValidReference(ref))
		.map((ref) => `<${ref.kind} id="${escapeXml(ref.id)}">${escapeXml(ref.label)}</${ref.kind}>`)
		.join("");
	if (tags === "") return msg.text;
	return msg.text === "" ? tags : `${msg.text}\n${tags}`;
}

function isValidReference(ref: unknown): ref is ConversationReference {
	if (ref === null || typeof ref !== "object") return false;
	const candidate = ref as { kind?: unknown; id?: unknown };
	return (
		typeof candidate.kind === "string" &&
		REFERENCE_KINDS.includes(candidate.kind) &&
		typeof candidate.id === "string" &&
		candidate.id.trim() !== ""
	);
}

function escapeXml(value: string): string {
	return value.replace(/[&<>"]/g, (ch) => {
		switch (ch) {
			case "&":
				return "&amp;";
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			default:
				return "&quot;";
		}
	});
}
