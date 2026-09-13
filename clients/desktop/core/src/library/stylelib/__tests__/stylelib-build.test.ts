import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Provider } from "../../../../runtime/provider/Provider.js";
import type { ProviderResult } from "../../../../runtime/provider/types.js";
import { LibraryService } from "../../LibraryService.js";
import { stylelibEmbPath, stylelibFilePath } from "../../LibraryPaths.js";
import { buildStylelib } from "../build.js";
import { FakeEmbeddingProvider } from "../embed.js";
import { loadStylelibIndex } from "../retrieve.js";

/** 样例书：三章各两段（每段 ≥20 字，满足选段长度下限） */
function sampleBookText(): string {
	return [
		["第一章 雨夜", "雨下了三天，青石板泛着水光，茶馆的灯在风里晃得像一句谎话。", "他把刀放在案上，转身走进巷子深处，影子被灯火拉得很长很长。"].join("\n"),
		["第二章 旧账", "掌柜的手在抖，算盘却一声不响，账本翻到黑水镇那一页就停住了。", "“十年前的事，你还记得多少？”他问，声音轻得像在替对方数伤口。"].join("\n"),
		["第三章 断桥", "桥断了三年，人等了三年，对岸的灯每晚都亮，亮得让人心里发慌。", "今夜他过桥，踩的是自己的影子，刀在鞘里跟着心跳一起发烫。"].join("\n"),
	].join("\n\n");
}

/** fake 策展 provider：从 prompt 的【组 N】块取首段回选（子串校验天然通过；组序奇偶定标签） */
function fakeCurator(): Provider {
	return {
		call: async (call) => {
			const prompt = call.messages[0]?.content ?? "";
			const selections: Array<{ group: number; text: string; styleTag: string; keywords: string[] }> = [];
			// 前瞻切分（首组前无空行也与 intro 同 chunk，不能按块首 ^ 锚定）；
			// 取首个 ≥20 字段落（章标记行余文会形成 2 字碎片首段——真实解析行为）
			for (const block of prompt.split(/(?=【组 \d+】)/)) {
				const header = /^【组 (\d+)】/.exec(block);
				if (header === null) continue;
				const no = Number(header[1]);
				const paras = [...block.matchAll(/^\d+\. (.+)$/gm)].map((m) => m[1] ?? "");
				const text = paras.find((p) => p.length >= 20);
				if (text === undefined) continue;
				selections.push({
					group: no,
					text,
					styleTag: no % 2 === 1 ? "环境白描" : "对话吐槽",
					keywords: ["闲聊"],
				});
			}
			const content = JSON.stringify({ selections });
			return { finishReason: "stop", message: { role: "assistant", content } } as ProviderResult;
		},
		getModelInfo: () => {
			throw new Error("not used");
		},
	};
}

/** 建临时库并导入样例书 */
async function importSample(libraryRoot: string): Promise<string> {
	writeFileSync(join(libraryRoot, "书.txt"), sampleBookText(), "utf8");
	const service = new LibraryService({ libraryRoot });
	const result = await service.importBook({ sourcePath: join(libraryRoot, "书.txt"), title: "样例书" });
	service.close();
	return result.bookId;
}

describe("stylelib 建库", () => {
	it("全链：抽样 → 策展 → 校验 → 嵌入 → 落盘（json+emb 行序一致，段均原文子串）", async () => {
		const root = join(tmpdir(), `stylelib-build-${randomUUID()}`);
		mkdirSync(root, { recursive: true });
		try {
			const bookId = await importSample(root);
			const stats = await buildStylelib({
				libraryRoot: root,
				bookId,
				provider: fakeCurator(),
				sampling: { model: "test-model", maxTokens: 4096, thinking: "off" },
				embed: new FakeEmbeddingProvider(),
			});
			// 3 章 = 3 组 1 批，每组选 1 段
			expect(stats.candidates).toBe(3);
			expect(stats.batches).toBe(1);
			expect(stats.kept).toBe(3);
			expect(stats.vectorless).toBe(false);
			expect(stats.tags["环境白描"]).toBe(2);
			expect(stats.tags["对话吐槽"]).toBe(1);
			// 文件落盘 + 契约
			const doc = JSON.parse(readFileSync(stylelibFilePath(root, bookId), "utf8")) as {
				schema: number;
				paragraphs: Array<{ id: string; text: string; paragraphId: string }>;
			};
			expect(doc.schema).toBe(1);
			expect(doc.paragraphs.map((p) => p.id)).toEqual([
				`${bookId}-sl-0001`,
				`${bookId}-sl-0002`,
				`${bookId}-sl-0003`,
			]);
			// 子串保证：每段可在其溯源批文件中找到（压空白归一）
			const manifest = readFileSync(join(root, bookId, "paragraphs", "manifest.jsonl"), "utf8")
				.split(/\r?\n/)
				.filter((l) => l.trim().length > 0)
				.map((l) => JSON.parse(l) as { id: string; file: string });
			for (const para of doc.paragraphs) {
				const batch = manifest.find((m) => m.id === para.paragraphId);
				expect(batch).toBeDefined();
				const batchText = readFileSync(join(root, bookId, batch?.file ?? ""), "utf8");
				expect(batchText.replace(/\s+/g, "")).toContain(para.text.replace(/\s+/g, ""));
			}
			// emb 文件：N×512 Float32；经 loadStylelibIndex 读回可检索
			const emb = readFileSync(stylelibEmbPath(root, bookId));
			expect(emb.byteLength).toBe(3 * 512 * 4);
			const index = await loadStylelibIndex(root, bookId);
			expect(index?.doc.paragraphs.length).toBe(3);
			expect(index?.vectors?.length).toBe(3 * 512);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("无嵌入提供者：vectorless 建库（无 emb 文件、清除残留），检索降级关键字", async () => {
		const root = join(tmpdir(), `stylelib-novec-${randomUUID()}`);
		mkdirSync(root, { recursive: true });
		try {
			const bookId = await importSample(root);
			await buildStylelib({
				libraryRoot: root,
				bookId,
				provider: fakeCurator(),
				sampling: { model: "test-model", maxTokens: 4096, thinking: "off" },
			});
			const stats2 = JSON.parse(readFileSync(stylelibFilePath(root, bookId), "utf8")) as {
				stats: { vectorless: boolean };
			};
			expect(stats2.stats.vectorless).toBe(true);
			const index = await loadStylelibIndex(root, bookId);
			expect(index?.vectors).toBeUndefined();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("重建幂等：整库覆盖（不同策展产出 → 旧段不留）", async () => {
		const root = join(tmpdir(), `stylelib-rebuild-${randomUUID()}`);
		mkdirSync(root, { recursive: true });
		try {
			const bookId = await importSample(root);
			const sampling = { model: "test-model", maxTokens: 4096, thinking: "off" } as const;
			await buildStylelib({ libraryRoot: root, bookId, provider: fakeCurator(), sampling: { ...sampling }, embed: new FakeEmbeddingProvider() });
			// 第二次：策展空手而归（selections 恒空）
			const empty: Provider = {
				call: async () =>
					({ finishReason: "stop", message: { role: "assistant", content: '{"selections":[]}' } }) as ProviderResult,
				getModelInfo: () => {
					throw new Error("not used");
				},
			};
			const stats = await buildStylelib({ libraryRoot: root, bookId, provider: empty, sampling: { ...sampling } });
			expect(stats.kept).toBe(0);
			expect(stats.vectorless).toBe(true);
			const doc = JSON.parse(readFileSync(stylelibFilePath(root, bookId), "utf8")) as {
				paragraphs: unknown[];
			};
			expect(doc.paragraphs).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("策展批失败重试一次仍失败：该批放弃、不阻断建库", async () => {
		const root = join(tmpdir(), `stylelib-fail-${randomUUID()}`);
		mkdirSync(root, { recursive: true });
		try {
			const bookId = await importSample(root);
			let calls = 0;
			const failing: Provider = {
				call: async () => {
					calls += 1;
					throw new Error("provider down");
				},
				getModelInfo: () => {
					throw new Error("not used");
				},
			};
			const stats = await buildStylelib({
				libraryRoot: root,
				bookId,
				provider: failing,
				sampling: { model: "test-model", maxTokens: 4096, thinking: "off" },
			});
			expect(calls).toBe(2); // 失败重试一次
			expect(stats.failedBatches).toBe(1);
			expect(stats.kept).toBe(0);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
