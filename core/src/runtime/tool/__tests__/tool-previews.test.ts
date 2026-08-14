import { describe, expect, it } from "vitest";
import {
	characterReadPreview,
	characterWritePreview,
	characterEditPreview,
	locationWritePreview,
	paragraphReadPreview,
	paragraphWritePreview,
	paragraphEditPreview,
	publicationWritePreview,
	novelDeletePreview,
	outlineWritePreview,
	fileReadPreview,
	fileGlobPreview,
	fileWritePreview,
	fileEditPreview,
	todoWritePreview,
	defaultToolPreview,
	resolveToolPreview,
	TOOL_PREVIEWS,
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

	it("resolveToolPreview：全部现有工具已注册、未知工具返回 undefined", () => {
		for (const name of [
			"CharacterRead", "CharacterWrite", "CharacterEdit",
			"LocationRead", "LocationWrite", "LocationEdit",
			"ParagraphRead", "ParagraphWrite", "ParagraphEdit",
			"PublicationRead", "PublicationWrite", "PublicationEdit",
			"NovelDelete", "OutlineRead", "OutlineWrite", "OutlineEdit",
			"Read", "Glob", "Write", "Edit", "TodoWrite",
		]) {
			expect(resolveToolPreview(name), name).toBeDefined();
			expect(TOOL_PREVIEWS.get(name), name).toBeDefined();
		}
		expect(resolveToolPreview("UnknownTool")).toBeUndefined();
	});
});

describe("实体域 preview（read/edit 语义 + 结果短语）", () => {
	it("CharacterRead：单读带 id、列表不带；recorded 给结果", () => {
		expect(characterReadPreview({ args: '{"characterId":"c1"}' })).toEqual({ title: "角色：c1" });
		expect(characterReadPreview({ args: "{}" })).toEqual({ title: "角色列表" });
		expect(characterReadPreview({ args: "{}" }, { result: "[]" })).toEqual({
			title: "角色列表",
			summary: "已读取",
		});
	});

	it("CharacterEdit：patch.name 优先于 characterId", () => {
		const args = JSON.stringify({
			values: [{ characterId: "c1", baseRevision: 1, patch: { name: "张三" } }, { characterId: "c2", baseRevision: 1, patch: {} }],
		});
		expect(characterEditPreview({ args })).toEqual({ title: "角色：张三、c2" });
		expect(characterEditPreview({ args }, { error: "stale" })).toEqual({
			title: "角色：张三、c2",
			summary: "角色更新失败",
		});
	});

	it("LocationWrite：地点名标题 + 写入结果", () => {
		const args = JSON.stringify({ values: [{ name: "青云山" }] });
		expect(locationWritePreview({ args })).toEqual({ title: "地点：青云山" });
		expect(locationWritePreview({ args }, { result: "ok" })).toEqual({
			title: "地点：青云山",
			summary: "地点已写入",
		});
	});

	it("ParagraphRead/Edit：目标标题 + 新文本摘要", () => {
		expect(paragraphReadPreview({ args: '{"paragraphId":"p1"}' })).toEqual({ title: "正文：p1" });
		expect(paragraphReadPreview({ args: '{"storyUnitId":"ch3"}' })).toEqual({ title: "正文：ch3" });
		expect(paragraphEditPreview({ args: '{"paragraphId":"p1","baseRevision":1,"text":"新正文"}' })).toEqual({
			title: "正文：p1",
			summary: "新正文",
		});
		expect(paragraphEditPreview({ args: '{"paragraphId":"p1","baseRevision":1,"text":"新"}' }, { result: "ok" })).toEqual({
			title: "正文：p1",
			summary: "正文已更新",
		});
	});

	it("PublicationWrite：卷/章标题；NovelDelete：kind 标签聚合；OutlineWrite：大纲标题", () => {
		expect(publicationWritePreview({ args: '{"kind":"chapter","title":"第一章"}' })).toEqual({
			title: "发布：章「第一章」",
		});
		expect(publicationWritePreview({ args: '{"kind":"volume","title":"上卷"}' }, { result: "ok" })).toEqual({
			title: "发布：卷「上卷」",
			summary: "已创建",
		});
		expect(
			novelDeletePreview({
				args: JSON.stringify({ values: [{ kind: "character", id: "c1", baseRevision: 1 }, { kind: "paragraph", id: "p1", baseRevision: 1 }] }),
			}),
		).toEqual({ title: "删除：角色、段落（2 项）" });
		expect(outlineWritePreview({ args: '{"title":"第一卷：风起"}' }, { result: "ok" })).toEqual({
			title: "大纲：第一卷：风起",
			summary: "已创建",
		});
	});
});

describe("files/todo 域 preview", () => {
	it("Read/Glob：目标标题 + 读取结果", () => {
		expect(fileReadPreview({ args: '{"file_path":"docs/设计.md"}' })).toEqual({ title: "读取：设计.md" });
		expect(fileGlobPreview({ args: '{"pattern":"**/*.md"}' })).toEqual({ title: "查找：**/*.md" });
		expect(fileReadPreview({ args: '{"file_path":"a.md"}' }, { error: "e" })).toEqual({
			title: "读取：a.md",
			summary: "读取失败",
		});
	});

	it("Write/Edit：内容/替换摘要 + 结果", () => {
		expect(fileWritePreview({ args: '{"file_path":"a.txt","content":"hello"}' })).toEqual({
			title: "写入：a.txt",
			summary: "hello",
		});
		expect(fileWritePreview({ args: '{"file_path":"a.txt","content":"hello"}' }, { result: "ok" })).toEqual({
			title: "写入：a.txt",
			summary: "已写入",
		});
		expect(fileEditPreview({ args: '{"file_path":"a.txt","old_string":"旧","new_string":"新"}' })).toEqual({
			title: "编辑：a.txt",
			summary: "旧",
		});
	});

	it("TodoWrite：条数标题 + 进行中项摘要", () => {
		const args = JSON.stringify({
			todos: [
				{ content: "写第一章", status: "pending", activeForm: "正在写第一章" },
				{ content: "写第二章", status: "in_progress", activeForm: "正在写第二章" },
			],
		});
		expect(todoWritePreview({ args })).toEqual({ title: "待办：2 项", summary: "正在写第二章" });
		expect(todoWritePreview({ args }, { result: "ok" })).toEqual({ title: "待办：2 项", summary: "已更新" });
	});
});
