import { describe, expect, it } from "vitest";
import type { ParagraphManifestEntry } from "../../LibraryService.js";
import { buildCurationPrompt, parseCuration, type CurateGroup } from "../curate.js";

/** 长样例段（≥20 字） */
const PARA_1 = "雨下了三天，青石板泛着水光，茶馆的灯在风里晃得像一句谎话。";
const PARA_2 = "掌柜的手在抖，算盘却一声不响，账本翻到黑水镇那一页就停住了。";
const PARA_SHORT = "刀出鞘了。";

/** 造段落组 */
function group(no: number, paragraphs: readonly string[]): CurateGroup {
	const entry: ParagraphManifestEntry = {
		id: `bk_test-p${String(no).padStart(6, "0")}`,
		chapterNo: no,
		chapterTitle: `第${no}章`,
		chars: paragraphs.join("").length,
		file: `paragraphs/bk_test-p${String(no).padStart(6, "0")}.md`,
	};
	return { no, entry, paragraphs, batchText: paragraphs.join("\n\n") };
}

describe("stylelib 策展 prompt", () => {
	it("含组标记/溯源 id/章归属/照抄纪律/标签枚举/JSON 契约", () => {
		const prompt = buildCurationPrompt([group(1, [PARA_1, PARA_2])]);
		expect(prompt).toContain("【组 1】bk_test-p000001（第 1 章·第1章）");
		expect(prompt).toContain(`1. ${PARA_1}`);
		expect(prompt).toContain("每组最多选 2 段");
		expect(prompt).toContain("允许整批全不选");
		expect(prompt).toContain("原文整段照抄");
		expect(prompt).toContain("对话吐槽 / 环境白描 / 打斗 / 情绪爆发 / 日常闲笔 / 叙事推进");
		expect(prompt).toContain('{"selections": [{"group": 1');
	});
});

describe("stylelib 策展解析", () => {
	it("合法回复：等段匹配入库，字段齐全", () => {
		const reply = JSON.stringify({
			selections: [{ group: 1, text: PARA_1, styleTag: "环境白描", keywords: ["雨夜", "茶馆", "闲聊", ""] }],
		});
		const result = parseCuration(reply, [group(1, [PARA_1, PARA_2])]);
		expect(result.picks).toHaveLength(1);
		const pick = result.picks[0];
		expect(pick?.text).toBe(PARA_1);
		expect(pick?.paragraphId).toBe("bk_test-p000001");
		expect(pick?.chapterNo).toBe(1);
		expect(pick?.styleTag).toBe("环境白描");
		// 空关键字被清洗；有效关键字保留
		expect(pick?.keywords).toEqual(["雨夜", "茶馆", "闲聊"]);
		expect(result.dropped.notSubstring).toBe(0);
	});

	it("改写段拒收（非原文子串计 notSubstring）；拼接批文子串放行", () => {
		const rewritten = `${PARA_1}他忽然笑了。`;
		const partial = PARA_2.slice(0, 20); // 批文真子串（非整段）
		const reply = JSON.stringify({
			selections: [
				{ group: 1, text: rewritten, styleTag: "环境白描", keywords: [] },
				{ group: 1, text: partial, styleTag: "对话吐槽", keywords: [] },
			],
		});
		const result = parseCuration(reply, [group(1, [PARA_1, PARA_2])]);
		expect(result.dropped.notSubstring).toBe(1);
		expect(result.picks.map((p) => p.text)).toEqual([partial]);
	});

	it("组号越界 / 非法标签 / 超长 / 过短 / 重复 各计其罪", () => {
		const long = "长".repeat(151);
		const reply = JSON.stringify({
			selections: [
				{ group: 9, text: PARA_1, styleTag: "环境白描", keywords: [] },
				{ group: 1, text: PARA_1, styleTag: "恋爱脑", keywords: [] },
				{ group: 1, text: long, styleTag: "环境白描", keywords: [] },
				{ group: 1, text: PARA_SHORT, styleTag: "环境白描", keywords: [] },
				{ group: 1, text: PARA_1, styleTag: "环境白描", keywords: [] },
				{ group: 1, text: PARA_1, styleTag: "环境白描", keywords: [] },
			],
		});
		const result = parseCuration(reply, [group(1, [PARA_1, PARA_2])]);
		expect(result.dropped.badGroup).toBe(1);
		expect(result.dropped.badTag).toBe(1);
		expect(result.dropped.tooLong).toBe(1);
		expect(result.dropped.tooShort).toBe(1);
		expect(result.dropped.duplicate).toBe(1);
		expect(result.picks).toHaveLength(1);
	});

	it("坏回复（围栏/前后噪声/非 JSON）容错不抛错", () => {
		const groups = [group(1, [PARA_1])];
		const fenced = "```json\n" + JSON.stringify({ selections: [{ group: 1, text: PARA_1, styleTag: "打斗", keywords: [] }] }) + "\n```";
		expect(parseCuration(fenced, groups).picks).toHaveLength(1);
		const noisy = `好的，以下是结果：\n${JSON.stringify({ selections: [{ group: 1, text: PARA_1, styleTag: "打斗", keywords: [] }] })}\n以上。`;
		expect(parseCuration(noisy, groups).picks).toHaveLength(1);
		expect(parseCuration("完全不是 JSON", groups).picks).toEqual([]);
		expect(parseCuration("{\"selections\": \"不是数组\"}", groups).picks).toEqual([]);
	});
});
