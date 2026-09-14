import { describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ToolCall, ProviderResult } from "../../../provider/types.js";
import type { Provider } from "../../../provider/Provider.js";
import type { AgentCapability } from "../../AgentCapability.js";
import { LoopContext } from "../../../loop/LoopContext.js";
import { novelStylelibSection } from "../../../prompt/sections/novelStylelib.js";
import { LibraryService } from "../../../../library/LibraryService.js";
import { addBookToLibraryAllowlist } from "../../../../library/LibraryAccessPolicy.js";
import { buildStylelib } from "../../../../library/stylelib/build.js";
import { FakeEmbeddingProvider } from "../../../../library/stylelib/embed.js";
import type { NovelQuery } from "../../../../novel/contract/query.js";
import { combineSeedMessages, createStylelibProvider, createStylelibSeed } from "../stylelibProvider.js";
import { wrapStylelibGuideMessage } from "../stylelibGuideMessage.js";
import { recordFocusFromCall } from "../../../tool/definitions/novel.js";
import { WritingFocusStore, type WritingFocusRecorder, type WritingFocusSnapshot } from "../WritingFocusStore.js";

// ── 焦点存储与提取 ──

/** 收集型记录面 */
function collector(): { records: WritingFocusSnapshot[]; recorder: WritingFocusRecorder } {
	const records: WritingFocusSnapshot[] = [];
	return { records, recorder: { record: (focus) => records.push(focus) } };
}

function callOf(kind: string, values: unknown): ToolCall {
	return { id: "t1", name: "NovelWrite", args: JSON.stringify({ kind, values }) };
}

describe("写作焦点", () => {
	it("Store：unit-less 快照忽略；current 反映最近记录", () => {
		const store = new WritingFocusStore();
		expect(store.current()).toBeUndefined();
		store.record({ kind: "chapter", capturedAt: 1 });
		expect(store.current()).toBeUndefined();
		store.record({ kind: "paragraph", storyUnitId: "unit-1", capturedAt: 2 });
		expect(store.current()?.storyUnitId).toBe("unit-1");
	});

	it("recordFocusFromCall：paragraph 取 storyUnitId；story_unit 自选 id / 结果回传 id；chapter 取来源提示", () => {
		const { records, recorder } = collector();
		recordFocusFromCall(
			recorder,
			callOf("paragraph", [{ storyUnitId: "unit-p", text: "正文一句。", rhythm: "rise", intensity: 3 }]),
			"[]",
		);
		recordFocusFromCall(recorder, callOf("story_unit", [{ id: "unit-self", title: "场景" }]), "[]");
		recordFocusFromCall(
			recorder,
			callOf("story_unit", [{ title: "场景" }]),
			JSON.stringify([{ id: "unit-gen", status: "applied", version: 2 }]),
		);
		recordFocusFromCall(recorder, callOf("chapter", [{ title: "第一章", storyUnitId: "unit-hint" }]), "[]");
		recordFocusFromCall(recorder, callOf("character", [{ name: "楼成" }]), "[]");
		recordFocusFromCall(recorder, { id: "t9", name: "NovelWrite", args: "{bad json" }, "[]");
		expect(records.map((r) => r.storyUnitId)).toEqual(["unit-p", "unit-self", "unit-gen", "unit-hint"]);
	});
});

// ── provider / seed 装配（真库 + fake 嵌入 + fake handle） ──

const SAMPLE = [
	"第一章 雨夜",
	"雨下了三天，青石板泛着水光，茶馆的灯在风里晃得像一句谎话。",
	"“丑媳妇总得见公婆，你总不能在校门口站成望夫石吧？”蔡宗明一巴掌拍上他肩头。",
].join("\n");

/** fake 策展（取每组首个 ≥20 字段落——章标记行余文会形成碎片首段） */
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

/** fake novel 查询面：storyUnit.get 返回带 leaf 的单元；调用计数供缓存断言 */
function fakeHandle() {
	let queries = 0;
	const handle = {
		query: async <T>(q: NovelQuery): Promise<T> => {
			queries += 1;
			if ((q as { op: string }).op === "outline.storyUnit.get") {
				return {
					id: "unit-1",
					title: "雨夜茶馆",
					intent: "主角初见对手",
					synopsis: "雨夜的茶馆里两人第一次照面，话里有话。",
					leaf: {
						events: [{ description: "茶馆对坐试探" }],
						rhythmBeats: [{ readerEmotion: "紧张" }],
					},
				} as T;
			}
			return {} as T;
		},
	};
	return { handle, count: () => queries };
}

/** 建临时库（导入 + 建库 + 白名单授权）；返回 {libraryRoot, workspace, bookId} */
async function builtLibrary(): Promise<{
	libraryRoot: string;
	workspace: string;
	bookId: string;
}> {
	const root = join(tmpdir(), `stylelib-inject-${randomUUID()}`);
	const workspace = join(root, "ws");
	mkdirSync(join(root, "ws"), { recursive: true });
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

describe("stylelib 注入 provider", () => {
	it("焦点 → 检索 → 快照；同焦点指纹缓存（handle 只查一次）；内容含纪律声明", async () => {
		const lib = await builtLibrary();
		try {
			const focus = new WritingFocusStore();
			focus.record({ kind: "paragraph", storyUnitId: "unit-1", capturedAt: Date.now() });
			const { handle, count } = fakeHandle();
			const provider = createStylelibProvider({
				libraryRoot: lib.libraryRoot,
				workspace: lib.workspace,
				focus,
				handle,
				embed: new FakeEmbeddingProvider(),
			});
			const first = await provider();
			expect(first?.content).toContain("仅示范段落节奏与叙述腔，禁止复用其内容词句");
			expect(first?.content).toContain("示例·环境白描（雨夜）：");
			expect(first?.source.bookId).toBe(lib.bookId);
			expect(first?.source.hits.length).toBeGreaterThan(0);
			const second = await provider();
			expect(second).toBe(first); // 缓存命中（不重查 novel.db）
			expect(count()).toBe(1);
			// 焦点变更 → 重新检索
			focus.record({ kind: "paragraph", storyUnitId: "unit-2", capturedAt: Date.now() });
			// unit-2 在 fake handle 同样返回内容 → 仍可注入，且查询计数 +1
			const third = await provider();
			expect(third).toBeDefined();
			expect(count()).toBe(2);
		} finally {
			rmSync(lib.libraryRoot, { recursive: true, force: true });
		}
	});

	it("无焦点 / 未授权书单 / 未建库 → undefined（不注入不抛错）", async () => {
		const lib = await builtLibrary();
		try {
			const noFocus = createStylelibProvider({
				libraryRoot: lib.libraryRoot,
				workspace: lib.workspace,
				focus: new WritingFocusStore(),
				handle: fakeHandle().handle,
			});
			expect(await noFocus()).toBeUndefined();
			// 白名单外的工作区
			const noAllow = createStylelibProvider({
				libraryRoot: lib.libraryRoot,
				workspace: join(lib.libraryRoot, "ws-empty"),
				focus: (() => {
					const store = new WritingFocusStore();
					store.record({ kind: "paragraph", storyUnitId: "unit-1", capturedAt: 1 });
					return store;
				})(),
				handle: fakeHandle().handle,
			});
			expect(await noAllow()).toBeUndefined();
		} finally {
			rmSync(lib.libraryRoot, { recursive: true, force: true });
		}
	});
});

describe("stylelib Compose seed", () => {
	it("委派 prompt 前缀检索 → <novel-style-guide> system 消息；未授权 → undefined", async () => {
		const lib = await builtLibrary();
		try {
			const seed = createStylelibSeed({
				libraryRoot: lib.libraryRoot,
				workspace: lib.workspace,
				embed: new FakeEmbeddingProvider(),
			});
			const messages = await seed("为本场景起草行文设计：雨夜茶馆初见，两人对坐试探，情绪紧张。");
			expect(messages).toHaveLength(1);
			expect(messages?.[0]?.role).toBe("system");
			expect(messages?.[0]?.content).toContain("<novel-style-guide>");
			expect(messages?.[0]?.content).toContain("禁止复用其内容词句");
			const denied = createStylelibSeed({
				libraryRoot: lib.libraryRoot,
				workspace: join(lib.libraryRoot, "ws-empty"),
			});
			expect(await denied("任意委派")).toBeUndefined();
			// 空内容包装返回 undefined
			expect(wrapStylelibGuideMessage("")).toBeUndefined();
		} finally {
			rmSync(lib.libraryRoot, { recursive: true, force: true });
		}
	});

	it("combineSeedMessages：合并消息 + 逐个隔离失败", async () => {
		const combined = combineSeedMessages([
			async () => [{ role: "system", content: "A" }],
			async () => undefined,
			async () => {
				throw new Error("boom");
			},
			async () => [{ role: "system", content: "B" }],
		]);
		const messages = await combined("input");
		expect(messages?.map((m) => (m as { content: string }).content)).toEqual(["A", "B"]);
		expect(await combineSeedMessages([async () => undefined])("input")).toBeUndefined();
	});
});

// ── LoopContext 装配（novel.stylelib 动态段） ──

describe("LoopContext stylelib 接线", () => {
	const capability: AgentCapability = {
		systemSections: [
			{ kind: "static", id: "base", version: "1.0.0", label: "Base", render: () => "BASE" },
			novelStylelibSection,
		],
		toolDefs: [],
		compactPolicies: [],
		nudgePolicies: [],
	};

	it("provider 快照进 system；缺失时段省略（零残留）", async () => {
		const withSnapshot = new LoopContext({
			agentCapability: capability,
			workspace: "/ws",
			stylelibProvider: async () => ({
				content: "示例·环境白描：雨下了三天。",
				source: { bookId: "bk", hits: [{ id: "bk-sl-1", styleTag: "环境白描" }] },
			}),
		});
		const call = await withSnapshot.toProviderCall(
			{ sampling: { model: "m" } },
			{ curTurn: 1, maxTurn: 8, toolsLastTurn: new Map() },
		);
		expect(call.system).toContain("BASE");
		expect(call.system).toContain("示例·环境白描：雨下了三天。");
		const without = new LoopContext({ agentCapability: capability, workspace: "/ws" });
		const call2 = await without.toProviderCall(
			{ sampling: { model: "m" } },
			{ curTurn: 1, maxTurn: 8, toolsLastTurn: new Map() },
		);
		expect(call2.system).toContain("BASE");
		expect(call2.system).not.toContain("示例·");
	});
});
