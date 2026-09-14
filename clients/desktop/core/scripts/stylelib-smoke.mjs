// stylelib 真实冒烟（PRD 检索式形态示例 §7）：真实书 txt 导入临时书库 → 进程内
// 建库（真实 provider 策展 + 本地 ONNX 嵌入）→ 校验（子串保证/标签分布/条数）→
// 焦点串检索抽验（贴场景度人工核对）。运行前：pnpm build + 拉模型 +
// NOVEL_PROVIDER_API_KEY。
//   node scripts/stylelib-smoke.mjs <book.txt> [--target 1000]
//   检索抽验查询可加 --query "..."（可多次；缺省三组场景词）
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProvider } from "../dist/runtime/provider/Provider.js";
import { LibraryService } from "../dist/library/LibraryService.js";
import { buildStylelib } from "../dist/library/stylelib/build.js";
import { OnnxEmbeddingProvider } from "../dist/library/stylelib/embed.js";
import { loadStylelibIndex, retrieve, formatStylelibBlock } from "../dist/library/stylelib/retrieve.js";

const args = process.argv.slice(2);
const sourcePath = args.find((a) => !a.startsWith("--"));
const targetArg = args.indexOf("--target");
const target = targetArg >= 0 ? Number(args[targetArg + 1]) : undefined;
const queries = [];
for (let i = args.indexOf("--query"); i >= 0; i = args.indexOf("--query", i + 1)) {
	queries.push(args[i + 1]);
}
const DEFAULT_QUERIES = ["迎新自我介绍，紧张尴尬", "雨夜街道的白描氛围", "两人对坐试探，话里有话"];

async function main() {
	if (sourcePath === undefined) {
		console.error("用法：node scripts/stylelib-smoke.mjs <book.txt> [--target 1000] [--query ...]");
		process.exit(2);
	}
	if ((process.env.NOVEL_PROVIDER_API_KEY ?? "").trim() === "") {
		console.error("缺 NOVEL_PROVIDER_API_KEY（真实策展必需）");
		process.exit(1);
	}
	const libraryRoot = join(tmpdir(), `stylelib-smoke-${Date.now().toString(36)}`);
	mkdirSync(libraryRoot, { recursive: true });
	const startedAt = Date.now();
	try {
		console.log(`[smoke] 导入 ${sourcePath}`);
		const service = new LibraryService({ libraryRoot });
		const { bookId, stats } = await service.importBook({ sourcePath, title: "smoke" });
		console.log(`[smoke] 导入完成 bookId=${bookId} 章节=${stats.chapters} 批=${stats.batches} 字=${stats.chars}`);

		const embed = await OnnxEmbeddingProvider.create();
		if (embed === undefined) {
			console.warn("[smoke] 嵌入模型缺失（先 node scripts/fetch-stylelib-model.mjs）——本次建库 vectorless，检索走纯关键字");
		} else {
			// 预热 + 单条查询耗时观测
			const warmStart = Date.now();
			await embed.embed(["预热查询"]);
			console.log(`[smoke] ONNX 嵌入就绪（首次加载 ${Date.now() - warmStart}ms，维度 512）`);
		}
		const provider = createProvider({
			id: "stylelib-curator",
			type: process.env.NOVEL_PROVIDER_TYPE ?? "openai",
			// 缺省与 entrypoint 同源（NOVEL_PROVIDER_* env 链）：openai 类型默认 deepseek 端点
			baseUrl: process.env.NOVEL_PROVIDER_BASE_URL ?? "https://api.deepseek.com/v1",
			apiKey: process.env.NOVEL_PROVIDER_API_KEY,
			timeoutMs: 300_000,
		});
		const buildStats = await buildStylelib({
			libraryRoot,
			bookId,
			provider,
			sampling: {
				model: process.env.NOVEL_PROVIDER_MODEL ?? "deepseek-v4-flash",
				maxTokens: 4096,
				thinking: "off",
			},
			...(embed !== undefined ? { embed } : {}),
			...(target !== undefined && Number.isFinite(target) ? { target } : {}),
			// 诊断：策展失败原因直显 stderr（生产走 runner 的 pino 日志）
			logger: {
				warn: (event, fields) => console.error(`[smoke][warn] ${event}`, JSON.stringify(fields ?? {})),
				debug: () => {},
				info: () => {},
				trace: () => {},
				error: (event, fields) => console.error(`[smoke][error] ${event}`, JSON.stringify(fields ?? {})),
				child: () => arguments[0],
				flush: async () => {},
				close: async () => {},
			},
			onProgress: (done, total) => {
				if (done % 10 === 0 || done === total) console.log(`[smoke] 策展 ${done}/${total}`);
			},
		});
		console.log(`[smoke] 建库完成：候选=${buildStats.candidates} 批=${buildStats.batches} 失败批=${buildStats.failedBatches} 入库=${buildStats.kept} vectorless=${buildStats.vectorless}`);
		console.log(`[smoke] 标签分布：${JSON.stringify(buildStats.tags)}`);
		console.log(`[smoke] 丢弃：${JSON.stringify(buildStats.dropped)}`);

		const index = await loadStylelibIndex(libraryRoot, bookId);
		if (index === undefined) throw new Error("stylelib.json 读回失败");
		// 子串保证抽验：前 10 段必须能在其溯源批文件中找到
		let checked = 0;
		for (const para of index.doc.paragraphs.slice(0, 10)) {
			const manifestLine = readFileSync(join(libraryRoot, bookId, "paragraphs", "manifest.jsonl"), "utf8")
				.split(/\r?\n/)
				.find((line) => line.includes(para.paragraphId));
			if (manifestLine === undefined) throw new Error(`溯源缺失：${para.paragraphId}`);
			const file = JSON.parse(manifestLine).file;
			const batch = readFileSync(join(libraryRoot, bookId, file), "utf8");
			if (!batch.replace(/\s+/g, "").includes(para.text.replace(/\s+/g, ""))) {
				throw new Error(`子串校验失败：${para.id} 不在其批文中`);
			}
			checked += 1;
		}
		console.log(`[smoke] 子串保证抽验通过（${checked} 段）`);

		for (const query of queries.length > 0 ? queries : DEFAULT_QUERIES) {
			const queryVec = embed === undefined ? undefined : (await embed.embed([query]))[0];
			const t0 = Date.now();
			const hits = retrieve(index, query, queryVec, 3);
			const elapsed = Date.now() - t0;
			console.log(`\n[smoke] 查询「${query}」（含嵌入 ${elapsed}ms）top-3：`);
			console.log(
				hits.map((h) => `  ${h.entry.id} · ${h.entry.styleTag} · ${h.entry.keywords.join("/")}\n    ${h.entry.text.slice(0, 60)}`).join("\n") || "  （无命中）",
			);
		}
		console.log(`\n[smoke] 总耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
	} finally {
		rmSync(libraryRoot, { recursive: true, force: true });
	}
}

main().catch((err) => {
	console.error("[smoke] 失败：", err);
	process.exit(1);
});
