import { describe, it, expect } from "vitest";
import { extractNovelBlocks, extractNovelText } from "./novel-extract.js";

describe("extractNovelText", () => {
	it("提取 ```novel 块内正文（含前导解释与尾注）", () => {
		const final = [
			"好的，正文如下：",
			"```novel",
			"集风镇的雨，下了七天。",
			"沈砚背着刀进的镇。",
			"```",
			"以上为该场景正文。",
		].join("\n");
		expect(extractNovelText(final)).toBe("集风镇的雨，下了七天。\n沈砚背着刀进的镇。");
	});

	it("无 ```novel 块返回 null", () => {
		expect(extractNovelText("纯文字回复，没有代码块")).toBeNull();
	});

	it("块未闭合返回 null（防止截断正文被误当作正文）", () => {
		expect(extractNovelText("```novel\n有头无尾")).toBeNull();
	});

	it("多块时取第一个（首个即正文）", () => {
		const text = "```novel\n正文一。\n```\n```novel\n正文二。\n```";
		expect(extractNovelText(text)).toBe("正文一。");
		expect(extractNovelBlocks(text)).toEqual(["正文一。", "正文二。"]);
	});

	it("块首行允许附加字符（如 ```novel 带尾注）", () => {
		expect(extractNovelText("```novel 正文草稿\n雨落在瓦上。\n```")).toBe("雨落在瓦上。");
	});

	it("空块返回空串（非 null，块确实存在）", () => {
		expect(extractNovelText("```novel\n\n```")).toBe("");
	});
});
