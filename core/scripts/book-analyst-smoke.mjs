// BookAnalyst 端到端冒烟（PRD library-完本解构 F8）：
// 样例书 → BookImportService（导入 + 直构 spawner 拉起 BookAnalyst 子进程）
// → 轮询 book.meta.json 状态 → 校验产物（style/excerpts/大纲实体/引用 id 有效）。
// 运行前需先 pnpm build（desktop-child.mjs 走 dist）+ NOVEL_PROVIDER_API_KEY。
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { read } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SqliteNovelStore } from "../dist/novel/SqliteNovelStore.js";
import { LibraryService } from "../dist/library/LibraryService.js";
import { BookImportService } from "../dist/library/BookImportService.js";

const __dirname = dirnameOf(import.meta.url);
function dirnameOf(u) {
	return join(fileURLToPath(new URL(".", u)));
}

const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 8 * 60_000);

/** 样例书：短句武侠风（四章，每章数段，风格刻意鲜明便于摘录验证） */
function sampleBook() {
	const p = (s) => s;
	const chapters = [
		["第一章 雨夜", "雨下了三天。", "刀在鞘里，人在檐下。", "他数着更声，等一个不该来的人。", "来了。", "伞压得很低，低到看不见脸。", "刀出鞘的时候，雨停了半拍。", "半拍之后，雨声里多了一具尸体。"],
		["第二章 旧账", "酒是陈的，账是旧的。", "掌柜的手在抖，算盘却不响。", "\"十年前，黑水镇。\"他说。", "掌柜终于抬头，脸白得像纸钱。", "\"你还记得。\"", "\"我记得每一笔。\""],
		["第三章 断桥", "桥断了三年，人等了三年。", "对岸的灯每晚都亮，亮得像一句谎话。", "今夜他过桥，踩的是自己的影子。", "灯灭了。", "灯灭的地方，站着一个披蓑衣的人。", "\"你迟了。\"那人开口。", "\"路远。\"他答，刀已在手。"],
		["第四章 归人", "雪落进京城的时候，他到了。", "朱门大开，没人拦他。", "拦他的人，都在来时的路上。", "堂上那把椅子空着，像等了很多人，最后只等到他。", "他没坐。", "他把刀放在案上，转身走进雪里。"],
	];
	return chapters.map(([title, ...paras]) => [title, ...paras.map(p)].join("\n")).join("\n\n");
}

/** 主流程 */
async function main() {
	if ((process.env.NOVEL_PROVIDER_API_KEY ?? "").trim() === "") {
		console.error("缺 NOVEL_PROVIDER_API_KEY（真实 provider 冒烟必需）");
		process.exit(1);
	}
	const stamp = Date.now().toString(36);
	const root = join(tmpdir(), `book-analyst-smoke-${stamp}`);
	const libraryRoot = join(root, "library");
	const storedir = join(root, "conv");
	mkdirSync(libraryRoot, { recursive: true });
	mkdirSync(storedir, { recursive: true });
	const sourcePath = join(root, "sample-book.txt");
	writeFileSync(sourcePath, sampleBook(), "utf8");
	console.log(`书库根: ${libraryRoot}`);

	const service = new LibraryService({ libraryRoot });
	// 直构 spawner：无 manager WS——子进程走「独立脚本」路径（stdin 兜底 + 心跳驻留）
	let child;
	const spawner = {
		async spawn(opts) {
			writeFileSync(join(storedir, "task.json"), JSON.stringify(opts.task), "utf8");
			child = spawn(process.execPath, [join(__dirname, "desktop-child.mjs")], {
				stdio: ["ignore", "ignore", "inherit"],
				env: {
					...process.env,
					ELECTRON_RUN_AS_NODE: "1",
					CONVERSATION_ID: "conv-analyst-smoke",
					AGENT_ID: "main",
					NOVEL_AGENT_TYPE: opts.agentType,
					NOVEL_CONVERSATION_STOREDIR: storedir,
					NOVEL_CONVERSATION_WORKSPACE: libraryRoot,
					NOVEL_LIBRARY_ROOT: libraryRoot,
					NOVEL_ANALYST_TASK: join(storedir, "task.json"),
				},
			});
			child.on("exit", (code, signal) => {
				if (code !== 0 && signal === null) {
					console.error(`[smoke] 解析子进程异常退出 code=${code}`);
				}
			});
			return { conversationId: "conv-analyst-smoke" };
		},
	};

	const importer = new BookImportService({ service, spawner, libraryRoot });
	const result = await importer.importBook({
		sourcePath,
		title: "雨夜刀客（样例）",
	});
	console.log(`导入完成: bookId=${result.bookId} 章数=${result.stats.chapters} 分段=${result.stats.batches}`);

	// 轮询解析状态（Agent 收尾写 book.meta.json.status）
	const metaPath = join(libraryRoot, result.bookId, "book.meta.json");
	const startedAt = Date.now();
	let status = "解析中";
	while (Date.now() - startedAt < TIMEOUT_MS) {
		await new Promise((r) => setTimeout(r, 3000));
		try {
			status = JSON.parse(readFileSync(metaPath, "utf8")).status;
		} catch {
			// meta 读取失败：继续等
		}
		if (status === "已完成" || status === "解析失败") break;
		process.stdout.write(".");
	}
	console.log(`\n解析状态: ${status}（耗时 ${Math.round((Date.now() - startedAt) / 1000)}s）`);

	// 产物校验
	const failures = [];
	const bookDir = join(libraryRoot, result.bookId);
	const stylePath = join(bookDir, "analysis", "style.md");
	const excerptsPath = join(bookDir, "analysis", "excerpts.md");
	if (!existsSync(stylePath)) failures.push("analysis/style.md 缺失");
	if (!existsSync(excerptsPath)) failures.push("analysis/excerpts.md 缺失");

	// 引用 id 有效性：excerpts/style 中出现的 paragraph id 必须在 manifest 内
	const manifestRaw = readFileSync(join(bookDir, "paragraphs", "manifest.jsonl"), "utf8");
	const validIds = new Set(
		manifestRaw.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l).id),
	);
	for (const [name, path] of [["style", stylePath], ["excerpts", excerptsPath]]) {
		if (!existsSync(path)) continue;
		const text = await read(path, "utf8");
		const refs = [...text.matchAll(new RegExp(`${result.bookId}-p\\d{6}`, "g"))].map((m) => m[0]);
		const dangling = refs.filter((id) => !validIds.has(id));
		if (refs.length === 0) failures.push(`${name} 无任何 paragraph id 引用`);
		if (dangling.length > 0) failures.push(`${name} 悬空引用: ${dangling.slice(0, 3).join(",")}`);
	}

	// 库内智能解构实体（大纲幕级单元 / 人物）
	const store = new SqliteNovelStore(join(bookDir, "book.db"), { readOnly: true });
	const outline = await store.query({ op: "outline.get" });
	const characters = await store.query({ op: "characters.list" });
	const publication = await store.query({ op: "publication.get" });
	store.close();
	const unitCount = outline.units.length;
	const charCount = characters.length;
	console.log(`库内实体: story_unit=${unitCount} character=${charCount} volume=${publication.volumes.length} chapter=${publication.chapters.length}`);
	if (unitCount === 0) failures.push("库内无大纲 story unit（Agent 未产出幕级单元）");

	child?.kill();
	if (failures.length > 0 || status !== "已完成") {
		console.error("SMOKE FAILED:\n" + failures.map((f) => `- ${f}`).join("\n"));
		console.error(`产物目录（保留供排查）: ${root}`);
		process.exit(1);
	}
	rmSync(root, { recursive: true, force: true });
	console.log("SMOKE OK");
}

main().catch((err) => {
	console.error("SMOKE FAILED:", err);
	process.exit(1);
});
