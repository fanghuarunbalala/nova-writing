import { describe, expect, it } from "vitest";
import {
	agentTaskPreview,
	characterReadPreview,
	characterWritePreview,
	characterEditPreview,
	locationWritePreview,
	paragraphReadPreview,
	paragraphWritePreview,
	paragraphEditPreview,
	volumeWritePreview,
	chapterWritePreview,
	novelDeletePreview,
	outlineWritePreview,
	fileReadPreview,
	fileGlobPreview,
	fileWritePreview,
	fileEditPreview,
	todoWritePreview,
	taskOutputPreview,
	taskStopPreview,
	defaultToolPreview,
	resolveToolPreview,
	TOOL_PREVIEWS,
} from "../previews.js";

describe("defaultToolPreview（未声明 preview 的回退）", () => {
	it("started：args 截断为 title，动作标识 = 执行/工具名", () => {
		expect(defaultToolPreview({ args: '{"a":1}' }, undefined, "Foo")).toEqual({
			action: "执行",
			object: "Foo",
			title: '{"a":1}',
		});
	});

	it("超长 args 截断至 120 字符 + 省略号", () => {
		const args = `{"text":"${"长".repeat(300)}"}`;
		const out = defaultToolPreview({ args }, undefined, "Foo");
		expect(out.title).toHaveLength(121);
		expect(out.title?.endsWith("…")).toBe(true);
	});

	it("recorded：完成/失败短语", () => {
		expect(defaultToolPreview({ args: "x" }, { result: "ok" }, "Foo")).toEqual({
			action: "执行",
			object: "Foo",
			title: "x",
			summary: "执行完成",
		});
		expect(defaultToolPreview({ args: "x" }, { error: "boom" }, "Foo")).toEqual({
			action: "执行",
			object: "Foo",
			title: "x",
			summary: "执行失败",
		});
	});

	it("空 args：无 title；recorded 仅结果短语", () => {
		expect(defaultToolPreview({ args: "" }, undefined, "Foo")).toEqual({ action: "执行", object: "Foo" });
		expect(defaultToolPreview({ args: "" }, { result: "ok" }, "Foo")).toEqual({
			action: "执行",
			object: "Foo",
			summary: "执行完成",
		});
	});
});

describe("内置 preview（动作标识 + 纯内容 title）", () => {
	it("characterWritePreview：names 为纯内容 title；recorded 给写入结果", () => {
		const args = JSON.stringify({ values: [{ name: "张三" }, { name: "李四" }] });
		expect(characterWritePreview({ args })).toEqual({ action: "创建", object: "角色", title: "张三、李四" });
		expect(characterWritePreview({ args }, { result: "ok" })).toEqual({
			action: "创建",
			object: "角色",
			title: "张三、李四",
			summary: "角色已写入",
		});
		expect(characterWritePreview({ args }, { error: "e" })).toEqual({
			action: "创建",
			object: "角色",
			title: "张三、李四",
			summary: "角色写入失败",
		});
	});

	it("paragraphWritePreview：批量插入 → 首项 storyUnitId + 段数 + 正文开头摘要；recorded 给插入结果", () => {
		const args = JSON.stringify({ values: [{ storyUnitId: "ch3", text: "秋夜，风起。" }, { storyUnitId: "ch3", text: "第二段。" }] });
		expect(paragraphWritePreview({ args })).toEqual({
			action: "插入",
			object: "正文",
			title: "ch3（2 段）",
			summary: "秋夜，风起。",
		});
		expect(paragraphWritePreview({ args }, { result: "ok" })).toEqual({
			action: "插入",
			object: "正文",
			title: "ch3（2 段）",
			summary: "正文已插入",
		});
	});

	it("非法 JSON 参数不抛错（按缺省字段降级）", () => {
		expect(characterWritePreview({ args: "not-json" })).toEqual({ action: "创建", object: "角色" });
		expect(paragraphWritePreview({ args: "not-json" })).toEqual({ action: "插入", object: "正文" });
	});

	it("纯性：同输入两次调用结果深等（replay 确定性前提）", () => {
		const call = { args: JSON.stringify({ values: [{ name: "王五" }] }) };
		const response = { result: "ok" };
		expect(characterWritePreview(call, response)).toEqual(characterWritePreview(call, response));
		expect(defaultToolPreview(call, response, "Foo")).toEqual(defaultToolPreview(call, response, "Foo"));
	});

	it("resolveToolPreview：全部 27 个工具已注册、未知工具返回 undefined", () => {
		for (const name of [
			"NovelCharacterRead", "NovelCharacterWrite", "NovelCharacterEdit",
			"NovelLocationRead", "NovelLocationWrite", "NovelLocationEdit",
			"NovelParagraphRead", "NovelParagraphWrite", "NovelParagraphEdit",
			"NovelVolumeRead", "NovelVolumeWrite", "NovelVolumeEdit",
			"NovelChapterRead", "NovelChapterWrite", "NovelChapterEdit",
			"NovelDelete", "NovelOutlineRead", "NovelOutlineWrite", "NovelOutlineEdit",
			"Read", "Glob", "Write", "Edit", "TodoWrite",
			"Agent", "TaskOutput", "TaskStop",
		]) {
			expect(resolveToolPreview(name), name).toBeDefined();
			expect(TOOL_PREVIEWS.get(name), name).toBeDefined();
		}
		expect(resolveToolPreview("UnknownTool")).toBeUndefined();
	});
});

describe("实体域 preview（动作标识语义）", () => {
	it("CharacterRead：单读带 id 内容、列表无内容；recorded 给结果", () => {
		expect(characterReadPreview({ args: '{"characterId":"c1"}' })).toEqual({
			action: "读取",
			object: "角色",
			title: "c1",
		});
		expect(characterReadPreview({ args: "{}" })).toEqual({ action: "读取", object: "角色" });
		expect(characterReadPreview({ args: "{}" }, { result: "[]" })).toEqual({
			action: "读取",
			object: "角色",
			summary: "已读取",
		});
	});

	it("CharacterEdit：value.name 优先于 id（P1 形状 values[{id, baseRevision, value}]）", () => {
		const args = JSON.stringify({
			values: [{ id: "c1", baseRevision: 1, value: { name: "张三" } }, { id: "c2", baseRevision: 1, value: {} }],
		});
		expect(characterEditPreview({ args })).toEqual({ action: "编辑", object: "角色", title: "张三、c2" });
		expect(characterEditPreview({ args }, { error: "stale" })).toEqual({
			action: "编辑",
			object: "角色",
			title: "张三、c2",
			summary: "角色更新失败",
		});
	});

	it("LocationWrite：地点内容 + 写入结果", () => {
		const args = JSON.stringify({ values: [{ name: "青云山" }] });
		expect(locationWritePreview({ args })).toEqual({ action: "创建", object: "地点", title: "青云山" });
		expect(locationWritePreview({ args }, { result: "ok" })).toEqual({
			action: "创建",
			object: "地点",
			title: "青云山",
			summary: "地点已写入",
		});
	});

	it("ParagraphRead/Edit：正文内容 + 新文本摘要", () => {
		expect(paragraphReadPreview({ args: '{"paragraphId":"p1"}' })).toEqual({
			action: "读取",
			object: "正文",
			title: "p1",
		});
		expect(paragraphReadPreview({ args: '{"storyUnitId":"ch3"}' })).toEqual({
			action: "读取",
			object: "正文",
			title: "ch3",
		});
		expect(paragraphEditPreview({ args: '{"values":[{"id":"p1","baseRevision":1,"value":{"text":"新正文"}}]}' })).toEqual({
			action: "编辑",
			object: "正文",
			title: "p1",
			summary: "新正文",
		});
		expect(paragraphEditPreview({ args: '{"values":[{"id":"p1","baseRevision":1,"value":{"text":"新"}}]}' }, { result: "ok" })).toEqual({
			action: "编辑",
			object: "正文",
			title: "p1",
			summary: "正文已更新",
		});
	});

	it("VolumeWrite/ChapterWrite：卷章内容；NovelDelete：kind 标签聚合；OutlineWrite：大纲内容", () => {
		expect(chapterWritePreview({ args: '{"values":[{"title":"第一章"}]}' })).toEqual({
			action: "创建",
			object: "章",
			title: "第一章",
		});
		expect(volumeWritePreview({ args: '{"values":[{"title":"上卷"}]}' }, { result: "ok" })).toEqual({
			action: "创建",
			object: "卷",
			title: "上卷",
			summary: "已创建",
		});
		expect(
			novelDeletePreview({
				args: JSON.stringify({ values: [{ kind: "character", id: "c1", baseRevision: 1 }, { kind: "paragraph", id: "p1", baseRevision: 1 }] }),
			}),
		).toEqual({ action: "删除", object: "实体", title: "角色、段落（2 项）" });
		expect(outlineWritePreview({ args: '{"values":[{"title":"第一卷：风起"},{"title":"第二卷：云涌"}]}' }, { result: "ok" })).toEqual({
			action: "创建",
			object: "大纲",
			title: "第一卷：风起、第二卷：云涌",
			summary: "已创建",
		});
	});
});

describe("files/todo/subagent 域 preview", () => {
	it("Read/Glob：文件内容 + 结果", () => {
		expect(fileReadPreview({ args: '{"file_path":"docs/设计.md"}' })).toEqual({
			action: "读取",
			object: "文件",
			title: "设计.md",
		});
		expect(fileGlobPreview({ args: '{"pattern":"**/*.md"}' })).toEqual({
			action: "查找",
			object: "文件",
			title: "**/*.md",
		});
		expect(fileReadPreview({ args: '{"file_path":"a.md"}' }, { error: "e" })).toEqual({
			action: "读取",
			object: "文件",
			title: "a.md",
			summary: "读取失败",
		});
	});

	it("Write/Edit：文件内容 + 内容摘要 + 结果", () => {
		expect(fileWritePreview({ args: '{"file_path":"a.txt","content":"hello"}' })).toEqual({
			action: "写入",
			object: "文件",
			title: "a.txt",
			summary: "hello",
		});
		expect(fileWritePreview({ args: '{"file_path":"a.txt","content":"hello"}' }, { result: "ok" })).toEqual({
			action: "写入",
			object: "文件",
			title: "a.txt",
			summary: "已写入",
		});
		expect(fileEditPreview({ args: '{"file_path":"a.txt","old_string":"旧","new_string":"新"}' })).toEqual({
			action: "编辑",
			object: "文件",
			title: "a.txt",
			summary: "旧",
		});
	});

	it("TodoWrite：条数内容 + 进行中项摘要", () => {
		const args = JSON.stringify({
			todos: [
				{ content: "写第一章", status: "pending", activeForm: "正在写第一章" },
				{ content: "写第二章", status: "in_progress", activeForm: "正在写第二章" },
			],
		});
		expect(todoWritePreview({ args })).toEqual({
			action: "更新",
			object: "待办",
			title: "2 项",
			summary: "正在写第二章",
		});
		expect(todoWritePreview({ args }, { result: "ok" })).toEqual({
			action: "更新",
			object: "待办",
			title: "2 项",
			summary: "已更新",
		});
	});

	it("Agent/TaskOutput/TaskStop：子任务动作标识", () => {
		expect(agentTaskPreview({ args: '{"agentType":"explore","prompt":"梳理旧船坞细节"}' })).toEqual({
			action: "执行",
			object: "子任务",
			title: "explore",
			summary: "梳理旧船坞细节",
		});
		expect(agentTaskPreview({ args: '{"agentType":"explore","prompt":"x"}' }, { result: "ok" })).toEqual({
			action: "执行",
			object: "子任务",
			title: "explore",
			summary: "子任务执行完成",
		});
		expect(taskOutputPreview({ args: '{"taskIds":["t1","t2"]}' })).toEqual({
			action: "读取",
			object: "任务输出",
			title: "t1、t2",
		});
		expect(taskStopPreview({ args: '{"taskId":"task_1"}' }, { result: "ok" })).toEqual({
			action: "停止",
			object: "子任务",
			title: "task_1",
			summary: "已停止",
		});
	});
});
