import { describe, expect, it } from "vitest";
import { parseBookText } from "../BookTextParser.js";

/** 造一段正文（n 个自然段，每段约 40 字） */
function prose(n: number, tag = "段"): string {
	const lines: string[] = [];
	for (let i = 0; i < n; i += 1) {
		lines.push(`${tag}${i} 夜色沉下来，雨水敲在窗沿上，他握紧手中的刀，听见巷口传来熟悉的脚步声。`);
	}
	return lines.join("\n\n");
}

describe("BookTextParser", () => {
	it("第N章标记切章 + 章标题识别", () => {
		const text = ["第一章 觉醒", prose(3), "第二章 风起", prose(3)].join("\n");
		const parsed = parseBookText(text);
		expect(parsed.volumes).toHaveLength(1);
		const chapters = parsed.volumes[0].chapters;
		expect(chapters).toHaveLength(2);
		expect(chapters[0].no).toBe(1);
		expect(chapters[0].title).toBe("第一章 觉醒");
		expect(chapters[1].no).toBe(2);
		expect(chapters[1].title).toBe("第二章 风起");
	});

	it("序章/楔子/番外等特殊章标记识别", () => {
		const text = ["楔子", prose(2), "第一章 启程", prose(2), "番外一 婚后", prose(2)].join("\n");
		const chapters = parseBookText(text).volumes[0].chapters;
		expect(chapters.map((c) => c.title)).toEqual(["楔子", "第一章 启程", "番外一 婚后"]);
		expect(chapters.map((c) => c.no)).toEqual([1, 2, 3]);
	});

	it("第N卷标记开新卷，卷内章序全书连续", () => {
		const text = [
			"第一卷 少年",
			"第一章 出门",
			prose(2),
			"第二章 行路",
			prose(2),
			"第二卷 江湖",
			"第三章 入局",
			prose(2),
		].join("\n");
		const parsed = parseBookText(text);
		expect(parsed.volumes).toHaveLength(2);
		expect(parsed.volumes[0].title).toBe("第一卷 少年");
		expect(parsed.volumes[1].title).toBe("第二卷 江湖");
		const nos = parsed.volumes.flatMap((v) => v.chapters.map((c) => c.no));
		expect(nos).toEqual([1, 2, 3]);
	});

	it("无任何章标记 → 按字数虚拟切章", () => {
		const parsed = parseBookText(prose(600));
		expect(parsed.volumes).toHaveLength(1);
		expect(parsed.volumes[0].title).toBeNull();
		expect(parsed.volumes[0].chapters.length).toBeGreaterThan(1);
		for (const chapter of parsed.volumes[0].chapters) {
			expect(chapter.title).toMatch(/^第 \d+ 部分$/);
		}
	});

	it("分批：目标字数收批、硬上限不切自然段", () => {
		const longPara = "长".repeat(7000);
		const text = ["第一章", longPara, prose(100)].join("\n");
		const batches = parseBookText(text).volumes[0].chapters[0].batches;
		// 超长自然段独占一批（行=段，不切行）；其余按目标聚合
		expect(batches[0]).toBe(longPara);
		expect(batches.length).toBeGreaterThan(2);
		for (const batch of batches.slice(1)) {
			expect(batch.length).toBeLessThanOrEqual(6000);
		}
	});

	it("空书抛错", () => {
		expect(() => parseBookText("   \n\n  ")).toThrow(/为空/);
	});
});
