import { describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ProviderResult } from "../../../provider/types.js";
import type { Provider } from "../../../provider/Provider.js";
import { LibraryService } from "../../../../library/LibraryService.js";
import { addBookToLibraryAllowlist } from "../../../../library/LibraryAccessPolicy.js";
import { buildStylelib } from "../../../../library/stylelib/build.js";
import { FakeEmbeddingProvider } from "../../../../library/stylelib/embed.js";
import { createStylelibSearchTool } from "../stylelibSearchTool.js";
import { ToolError } from "../../../tool/errors.js";

const SAMPLE = [
	"第一章 雨夜",
	"雨下了三天，青石板泛着水光，茶馆的灯在风里晃得像一句谎话。",
	"“丑媳妇总得见公婆，你总不能在校门口站成望夫石吧？”蔡宗明一巴掌拍上他肩头。",
].join("\n");

/** fake 策展（取每组首个 ≥20 字段落） */
function fakeCurator(): Provider {
	return {
		call: async (call) => {
			const prompt = call.messages[0]?.content ?? "";
			const selections: Array<{ group: number; text: string; styleTag: string; keywords: string[] }> = [];
			for (const block of prompt.split(/(?=【组 \d+】)/)) {
				const header = /^【组 (\d+)】/.exec(block);
				if (header === null) continue;
				const text = [...block.matchAll(/^\d+\. (.+)$/gm)].map((m) => m[1] ?? "").find((p) => p.length >= 20);
				if (text === undefined) continue;
				selections.push({ group: Number(header[1]), text, styleTag: "环境白描", keywords: ["雨夜"] });
			}
			return {
				finishReason: "stop",
				message: { role: "assistant", content: JSON.stringify({ selections }) },
			} as ProviderResult;
		},
		getModelInfo: () => {
			throw new Error("not used");
		},
	};
}

/** 建临时库（导入 + 建库 + 白名单授权） */
async function builtLibrary(): Promise<{ libraryRoot: string; workspace: string; bookId: string }> {
	const root = join(tmpdir(), `stylelib-tool-${randomUUID()}`);
	const workspace = join(root, "ws");
	mkdirSync(workspace, { recursive: true });
	writeFileSync(join(root, "书.txt"), SAMPLE, "utf8");
	const service = new LibraryService({ libraryRoot: root });
	const { bookId } = await service.importBook({ sourcePath: join(root, "书.txt") });
	await buildStylelib({
		libraryRoot: root,
		bookId,
		provider: fakeCurator(),
		sampling: { model: "test-model", maxTokens: 4096, thinking: "off" },
		embed: new FakeEmbeddingProvider(),
	});
	await addBookToLibraryAllowlist(workspace, bookId);
	service.close();
	return { libraryRoot: root, workspace, bookId };
}

function execute(tool: ReturnType<typeof createStylelibSearchTool>, args: unknown): Promise<string> {
	return tool.handler.execute({ id: "t1", name: tool.name, args: JSON.stringify(args) });
}

describe("StylelibSearch 工具", () => {
	it("契约：受信只读（无 requireApproval）、描述自足（两步调用 + 纪律）", () => {
		const tool = createStylelibSearchTool({ libraryRoot: "/lib", workspace: "/ws" });
		expect(tool.name).toBe("StylelibSearch");
		expect(tool.requireApproval).toBeUndefined();
		expect(tool.description).toContain("SearchExtraTools");
		expect(tool.description).toContain("禁止复用其内容词句");
		const params = tool.parameters as { required?: string[] };
		expect(params.required).toEqual(["query"]);
	});

	it("命中：返回条目（id/标签/关键字/章序/原文）+ 尾部纪律声明", async () => {
		const lib = await builtLibrary();
		try {
			const tool = createStylelibSearchTool({
				libraryRoot: lib.libraryRoot,
				workspace: lib.workspace,
				embed: new FakeEmbeddingProvider(),
			});
			const result = await execute(tool, { query: "雨夜茶馆的白描氛围" });
			expect(result).toContain(`参考书 ${lib.bookId}`);
			expect(result).toContain("环境白描 · 雨夜");
			expect(result).toContain("第 1 章");
			expect(result).toContain("茶馆的灯在风里晃得像一句谎话");
			expect(result).toContain("（仅示范段落节奏与叙述腔，禁止复用其内容词句）");
		} finally {
			rmSync(lib.libraryRoot, { recursive: true, force: true });
		}
	});

	it("style_tag 过滤生效（异标签无命中给换词建议）；limit 截断", async () => {
		const lib = await builtLibrary();
		try {
			const tool = createStylelibSearchTool({
				libraryRoot: lib.libraryRoot,
				workspace: lib.workspace,
				embed: new FakeEmbeddingProvider(),
			});
			const filtered = await execute(tool, { query: "雨夜茶馆", style_tag: "打斗" });
			expect(filtered).toContain("无命中");
			const limited = await execute(tool, { query: "雨夜茶馆", limit: 1 });
			expect(limited.match(/^\[\d+\]/gm)).toHaveLength(1);
		} finally {
			rmSync(lib.libraryRoot, { recursive: true, force: true });
		}
	});

	it("降级：无授权书 → 提示建库；空 query → ToolError", async () => {
		const lib = await builtLibrary();
		try {
			const denied = createStylelibSearchTool({
				libraryRoot: lib.libraryRoot,
				workspace: join(lib.libraryRoot, "ws-empty"),
			});
			const result = await execute(denied, { query: "雨夜" });
			expect(result).toContain("无可用的风格示例库");
			const tool = createStylelibSearchTool({ libraryRoot: lib.libraryRoot, workspace: lib.workspace });
			await expect(execute(tool, { query: "  " })).rejects.toThrow(ToolError);
			await expect(execute(tool, {})).rejects.toThrow(ToolError);
		} finally {
			rmSync(lib.libraryRoot, { recursive: true, force: true });
		}
	});
});
