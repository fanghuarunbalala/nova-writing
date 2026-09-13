// stylelib 建库后台子进程入口（PRD 检索式形态示例 F1）：策展 LLM（~100 次批量调用）
// 与本地 ONNX 嵌入不在主进程执行，经 StylelibBuildRunner spawn 本脚本完成。
// 任务经 argv[2] 指向的 JSON 文件传入（{libraryRoot, bookId, target?}）；provider
// 配置继承主进程 env（NOVEL_PROVIDER_*）。stdout 按行输出协议（project-import-worker 同款）：
//   {"type":"progress","done":n,"total":m}
//   {"type":"result","ok":true,"value":stats} | {"type":"result","ok":false,"error":{"message"}}
import { readFileSync, rmSync } from "node:fs";
import { createProvider } from "../dist/runtime/provider/Provider.js";
import { buildStylelib } from "../dist/library/stylelib/build.js";
import { OnnxEmbeddingProvider } from "../dist/library/stylelib/embed.js";

const jobPath = process.argv[2];
if (jobPath === undefined) {
	process.stderr.write("stylelib-worker: 缺少任务文件参数\n");
	process.exit(2);
}

const emit = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
const startedAt = Date.now();
// 诊断日志走 stderr（stdout 是行协议）——宿主 StylelibBuildRunner 逐行转发进主日志
const log = (text) => process.stderr.write(`[stylelib-worker ${new Date().toISOString()}] ${text}\n`);

try {
	const job = JSON.parse(readFileSync(jobPath, "utf8"));
	if (typeof job?.libraryRoot !== "string" || typeof job?.bookId !== "string") {
		throw new Error("任务载荷缺少 libraryRoot/bookId");
	}
	log(`started bookId=${job.bookId} target=${job.target ?? "default"}`);
	const provider = createProvider({
		id: "stylelib-curator",
		type: process.env.NOVEL_PROVIDER_TYPE ?? "openai",
		...(process.env.NOVEL_PROVIDER_BASE_URL !== undefined
			? { baseUrl: process.env.NOVEL_PROVIDER_BASE_URL }
			: {}),
		apiKey: process.env.NOVEL_PROVIDER_API_KEY,
		// 策展批输入大（10 组 × 3500-6000 字）、输出小：放宽超时，SDK 默认重试兜底瞬断
		timeoutMs: 300_000,
	});
	const sampling = {
		model: process.env.NOVEL_PROVIDER_MODEL ?? "deepseek-v4-flash",
		maxTokens: 4096,
		thinking: "off",
	};
	const embed = await OnnxEmbeddingProvider.create().catch((err) => {
		log(`embedding unavailable (keyword-only): ${err instanceof Error ? err.message : String(err)}`);
		return undefined;
	});
	const stats = await buildStylelib({
		libraryRoot: job.libraryRoot,
		bookId: job.bookId,
		provider,
		sampling,
		...(embed !== undefined ? { embed } : {}),
		...(typeof job.target === "number" ? { target: job.target } : {}),
		onProgress: (done, total) => emit({ type: "progress", done, total }),
	});
	log(`finished kept=${stats.kept} vectorless=${stats.vectorless} elapsedMs=${Date.now() - startedAt}`);
	emit({ type: "result", ok: true, value: stats });
} catch (err) {
	log(`failed: ${err instanceof Error ? err.message : String(err)}`);
	emit({
		type: "result",
		ok: false,
		error: { message: err instanceof Error ? err.message : String(err) },
	});
	process.exitCode = 1;
} finally {
	rmSync(jobPath, { force: true });
}
