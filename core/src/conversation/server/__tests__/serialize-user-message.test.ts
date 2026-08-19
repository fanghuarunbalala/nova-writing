/**
 * serializeUserMessageText 单测（PRD conversation-目录下钻与实体引用 F6）：
 * 引用序列化为 novel.system 标签语法追加正文；无引用原样；纯引用可发；
 * id/label XML 转义；非法引用项剔除。
 */
import { describe, expect, it } from "vitest";
import { serializeUserMessageText } from "../serializeUserMessage.js";
import type { ConversationUserMessage } from "../../contract/types/message.js";

describe("serializeUserMessageText", () => {
	it("returns text as-is when references are absent or empty", () => {
		expect(serializeUserMessageText({ text: "你好" })).toBe("你好");
		expect(serializeUserMessageText({ text: "你好", references: [] })).toBe("你好");
	});

	it("appends reference tags after the text (paired form with label)", () => {
		const msg: ConversationUserMessage = {
			text: "帮我收紧这段",
			references: [
				{ kind: "character", id: "ch-1", label: "林夏" },
				{ kind: "paragraph", id: "p-2", label: "段 2 · 雨夜追逃" },
			],
		};
		expect(serializeUserMessageText(msg)).toBe(
			'帮我收紧这段\n<character id="ch-1">林夏</character><paragraph id="p-2">段 2 · 雨夜追逃</paragraph>',
		);
	});

	it("supports reference-only messages (empty text → tags only)", () => {
		const msg: ConversationUserMessage = {
			text: "",
			references: [{ kind: "chapter", id: "chap-1", label: "雾起" }],
		};
		expect(serializeUserMessageText(msg)).toBe('<chapter id="chap-1">雾起</chapter>');
	});

	it("escapes XML-special characters in id and label", () => {
		const msg: ConversationUserMessage = {
			text: "正文",
			references: [{ kind: "location", id: 'l"1', label: "a<b>&c" }],
		};
		expect(serializeUserMessageText(msg)).toBe(
			'正文\n<location id="l&quot;1">a&lt;b&gt;&amp;c</location>',
		);
	});

	it("drops invalid reference entries (bad kind / blank id) and keeps valid ones", () => {
		const msg = {
			text: "正文",
			references: [
				{ kind: "volume", id: "v-1", label: "第一卷" },
				{ kind: "character", id: "  ", label: "空白 id" },
				null,
				{ kind: "outline", id: "u1", label: "雾起" },
			],
		} as unknown as ConversationUserMessage;
		expect(serializeUserMessageText(msg)).toBe('正文\n<outline id="u1">雾起</outline>');
	});

	it("falls back to raw text when every reference is invalid", () => {
		const msg = {
			text: "只有正文",
			references: [{ kind: "nope", id: "x", label: "y" }],
		} as unknown as ConversationUserMessage;
		expect(serializeUserMessageText(msg)).toBe("只有正文");
	});
});
