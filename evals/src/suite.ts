/**
 * 套件运行（docs/PRD/eval-harness.md §8）：runEvalite(run-once-and-exit) →
 * results/<时间戳>-<tag>/{evalite.json, manifest.json}。
 * manifest 归因四件套：git SHA、prompt 渲染 sha256、tool schema sha256、model+采样，
 * 加 case 集 hash——回归报告能回答「哪个改动导致的结果变化」。
 *
 * 用法：pnpm --filter @novel/evals suite -- --tag baseline
 * 环境：NOVEL_EVAL_API_KEY（或 NOVEL_PROVIDER_API_KEY / ANTHROPIC_AUTH_TOKEN）；
 *       NOVEL_EVAL_MODEL（缺省 deepseek-v4-flash）、NOVEL_EVAL_BASE_URL（缺省 DeepSeek）。
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { runEvalite } from "evalite/runner";
import { buildNovelAgent, InMemoryNovelStore } from "@novel/core";
import type { NovelHandle, Provider } from "@novel/core";
import { writeReport } from "./report.js";

function sha256(s: string): string {
	return createHash("sha256").update(s).digest("hex");
}

function git(args: string): string {
	try {
		return execSync(`git ${args}`, { encoding: "utf8" }).trim();
	} catch {
		return "unknown";
	}
}

/** 与 Tier 0 快照同一套钉死装配，取 prompt 渲染与 tool schema 指纹（屏蔽动态日期行） */
async function agentFingerprint(): Promise<{
	promptSha256: string;
	toolSchemaSha256: string;
	toolCount: number;
}> {
	const provider: Provider = {
		call: async () => ({ finishReason: "stop", message: { role: "assistant", content: "ok" } }),
		getModelInfo: (model: string) => ({
			model,
			supportsTemperature: true,
			thinkingMode: "none" as const,
			contextWindowTokens: 128_000,
		}),
	};
	const store = new InMemoryNovelStore();
	const handle = {
		query: (q: unknown) => store.query(q as never),
		mutate: (m: unknown) => store.mutate(m as never),
		mutateBatch: (ms: readonly unknown[]) =>
			store.mutateBatch(ms as never[]) as unknown as Promise<unknown[]>,
	} as unknown as NovelHandle;
	const loop = buildNovelAgent({
		workspace: "/ws",
		provider,
		handle,
		conversationId: "conv-manifest",
		platform: "Windows",
		novelConstraintsProvider: async () => ({
			fileName: "NOVEL.md",
			content: "# 世界观\n- 基调热血",
		}),
	});
	await loop.run("hi", { sampling: { model: "gpt-5" } });
	const internals = loop as unknown as {
		config: {
			agentCapability: {
				toolDefs: Array<Record<string, unknown>>;
			};
		};
		context: { systemPrompt: string };
	};
	const prompt = internals.context.systemPrompt.replace(
		/^- 当前日期：.*$/gm,
		"- 当前日期：<masked>",
	);
	const toolDefs = internals.config.agentCapability.toolDefs.map((t) => ({
		name: t.name,
		version: t.version,
		description: t.description,
		parameters: t.parameters,
		promptDetail: t.promptDetail,
		requireApproval: t.requireApproval,
	}));
	return {
		promptSha256: sha256(prompt),
		toolSchemaSha256: sha256(JSON.stringify(toolDefs)),
		toolCount: toolDefs.length,
	};
}

async function caseSetFingerprint(): Promise<{
	caseFiles: string[];
	caseSetSha256: string;
}> {
	const dir = join(process.cwd(), "cases");
	let files: string[] = [];
	try {
		files = (await readdir(dir)).filter((f) => f.endsWith(".eval.ts")).sort();
	} catch {
		// 无 cases 目录（纯框架）时指纹为空集
	}
	const hash = createHash("sha256");
	for (const f of files) {
		hash.update(f).update(await readFile(join(dir, f), "utf8"));
	}
	return { caseFiles: files, caseSetSha256: hash.digest("hex") };
}

/** 夹具归因（F7）：fixtures/books 下各夹具 book.json 内容哈希（语料漂移可追溯） */
async function fixtureFingerprint(): Promise<{
	fixtures: Array<{ alias: string; sha256: string }>;
}> {
	const root = join(process.cwd(), "fixtures", "books");
	const books: Array<{ alias: string; sha256: string }> = [];
	try {
		for (const entry of (await readdir(root, { withFileTypes: true })).filter((e) =>
			e.isDirectory(),
		)) {
			try {
				const raw = await readFile(join(root, entry.name, "book.json"), "utf8");
				books.push({ alias: entry.name, sha256: sha256(raw).slice(0, 16) });
			} catch {
				// 无 book.json 的目录（半成品夹具）跳过
			}
		}
	} catch {
		// 无 fixtures 目录 = 空集
	}
	return { fixtures: books.sort((a, b) => a.alias.localeCompare(b.alias)) };
}

async function main(): Promise<void> {
	const tagIndex = process.argv.indexOf("--tag");
	const tag = tagIndex >= 0 ? (process.argv[tagIndex + 1] ?? "run") : "run";
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const outDir = join("results", `${stamp}-${tag}`);
	await mkdir(outDir, { recursive: true });

	console.log(`[suite] 运行评测套件 → ${outDir}`);
	await runEvalite({
		mode: "run-once-and-exit",
		outputPath: join(outDir, "evalite.json"),
	});

	const [fingerprint, caseSet, fixtures] = await Promise.all([
		agentFingerprint(),
		caseSetFingerprint(),
		fixtureFingerprint(),
	]);
	const manifest = {
		tag,
		created_at: new Date().toISOString(),
		git: {
			sha: git("rev-parse HEAD"),
			branch: git("rev-parse --abbrev-ref HEAD"),
		},
		model: {
			baseUrl: process.env.NOVEL_EVAL_BASE_URL ?? "https://api.deepseek.com/v1",
			model: process.env.NOVEL_EVAL_MODEL ?? "deepseek-v4-flash",
			judgeModel: process.env.NOVEL_EVAL_JUDGE_MODEL ?? null,
			temperature: 0,
		},
		...fingerprint,
		...caseSet,
		...fixtures,
	};
	await writeFile(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
	const reportPath = await writeReport(outDir);
	console.log(
		`[suite] 完成：manifest 已落盘（git ${manifest.git.sha.slice(0, 8)}，prompt ${fingerprint.promptSha256.slice(0, 8)}，schema ${fingerprint.toolSchemaSha256.slice(0, 8)}）`,
	);
	console.log(`[suite] 可视化报告：${reportPath}`);
}

await main();
