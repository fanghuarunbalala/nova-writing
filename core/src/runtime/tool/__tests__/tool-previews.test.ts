import { describe, expect, it } from "vitest";
import {
	characterWritePreview,
	defaultToolPreview,
	paragraphWritePreview,
	resolveToolPreview,
} from "../previews.js";

describe("defaultToolPreview（未声明 preview 的回退）", () => {
	it("started：args ≤120 字符原样为摘要", () => {
		expect(defaultToolPreview({ args: '{"a":1}' })).toEqual({ summary: '{"a":1}' });
	});

	it("超长 args 截断至 120 字符 + 省略号", () => {
		const args = `{"text":"${"长".repeat(300)}"}`;
		const out = defaultToolPreview({ args });
		expect(out.summary).toHaveLength(121);
		expect(out.summary?.endsWith("…")).toBe(true);
	});

	it("recorded：成功文案带摘要，失败文案带失败", () => {
		expect(defaultToolPreview({ args: "x" }, { result: "ok" })).toEqual({ summary: "x（执行完成）" });
		expect(defaultToolPreview({ args: "x" }, { error: "boom" })).toEqual({ summary: "x（执行失败）" });
	});

	it("空 args：started 无摘要，recorded 仅结果文案", () => {
		expect(defaultToolPreview({ args: "" })).toEqual({});
		expect(defaultToolPreview({ args: "" }, { result: "ok" })).toEqual({ summary: "执行完成" });
	});
});

describe("内置 preview（纯性 + 语义）", () => {
	it("characterWritePreview：解析 values[].name 为标题；recorded 给写入结果", () => {
		const args = JSON.stringify({ values: [{ name: "张三" }, { name: "李四" }] });
		expect(characterWritePreview({ args })).toEqual({ title: "角色：张三、李四" });
		expect(characterWritePreview({ args }, { result: "ok" })).toEqual({
			title: "角色：张三、李四",
			summary: "角色已写入",
		});
		expect(characterWritePreview({ args }, { error: "e" })).toEqual({
			title: "角色：张三、李四",
			summary: "角色写入失败",
		});
	});

	it("paragraphWritePreview：解析 storyUnitId 与正文开头；recorded 给插入结果", () => {
		const args = JSON.stringify({ storyUnitId: "ch3", text: "秋夜，风起。" });
		expect(paragraphWritePreview({ args })).toEqual({ title: "正文：ch3", summary: "秋夜，风起。" });
		expect(paragraphWritePreview({ args }, { result: "ok" })).toEqual({
			title: "正文：ch3",
			summary: "正文已插入",
		});
	});

	it("非法 JSON 参数不抛错（按缺省字段降级）", () => {
		expect(characterWritePreview({ args: "not-json" })).toEqual({ title: "角色" });
		expect(paragraphWritePreview({ args: "not-json" })).toEqual({ title: "正文" });
	});

	it("纯性：同输入两次调用结果深等（replay 确定性前提）", () => {
		const call = { args: JSON.stringify({ values: [{ name: "王五" }] }) };
		const response = { result: "ok" };
		expect(characterWritePreview(call, response)).toEqual(characterWritePreview(call, response));
		expect(defaultToolPreview(call, response)).toEqual(defaultToolPreview(call, response));
	});

	it("resolveToolPreview：已注册工具命中、未注册返回 undefined", () => {
		expect(resolveToolPreview("CharacterWrite")).toBe(characterWritePreview);
		expect(resolveToolPreview("ParagraphWrite")).toBe(paragraphWritePreview);
		expect(resolveToolPreview("CharacterRead")).toBeUndefined();
	});
});
