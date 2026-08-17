/**
 * 基线对比（docs/PRD/eval-harness.md §8）：读两个 results 目录的 evalite.json + manifest.json，
 * 输出逐 case delta（passRate / avgTurns / 错误码直方图）markdown 报告。
 * 回归红线：① passRate 降幅 >10pp；② 基线为 0 而候选出现 ≥2 次的 TOOL_ARGUMENTS_INVALID
 * （schema/desc 改坏的直接信号）。
 *
 * 用法：pnpm --filter @novel/evals compare -- results/<baseline目录> results/<candidate目录>
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EvalRunMetrics } from "./types.js";

interface Manifest {
	tag: string;
	created_at: string;
	git: { sha: string; branch: string };
	promptSha256: string;
	toolSchemaSha256: string;
	toolCount: number;
	model: { baseUrl: string; model: string; judgeModel: string | null; temperature: number };
	caseFiles: string[];
	caseSetSha256: string;
}

/** evalite --outputPath 导出结构（Evalite.Exported.Output）中本工具消费的子集 */
interface ExportedOutput {
	evals: Array<{
		name: string;
		status: string;
		results: Array<{
			status: string;
			output: unknown;
			scores: Array<{ name: string; score: number }>;
		}>;
	}>;
}

interface CaseSummary {
	name: string;
	runsTotal: number;
	runsAllPassed: number;
	passRate: number;
	avgTurns: number;
	totalTokens: number;
	errorHistogram: Record<string, number>;
}

function toCaseSummaries(json: ExportedOutput): Map<string, CaseSummary> {
	const out = new Map<string, CaseSummary>();
	for (const ev of json.evals ?? []) {
		let runsTotal = 0;
		let allPassed = 0;
		let turnsSum = 0;
		let tokens = 0;
		const hist: Record<string, number> = {};
		for (const r of ev.results ?? []) {
			runsTotal++;
			const m = r.output as Partial<EvalRunMetrics> | null | undefined;
			turnsSum += typeof m?.turns === "number" ? m.turns : 0;
			if (m?.usage !== undefined) {
				tokens += m.usage.inputTokens + m.usage.outputTokens;
			}
			for (const e of m?.toolErrors ?? []) {
				hist[e.code] = (hist[e.code] ?? 0) + 1;
			}
			if ((r.scores ?? []).length > 0 && r.scores.every((s) => s.score === 1)) {
				allPassed++;
			}
		}
		out.set(ev.name, {
			name: ev.name,
			runsTotal,
			runsAllPassed: allPassed,
			passRate: runsTotal === 0 ? 0 : allPassed / runsTotal,
			avgTurns: runsTotal === 0 ? 0 : turnsSum / runsTotal,
			totalTokens: tokens,
			errorHistogram: hist,
		});
	}
	return out;
}

async function loadRunDir(dir: string): Promise<{
	summaries: Map<string, CaseSummary>;
	manifest: Manifest;
}> {
	const [evaliteRaw, manifestRaw] = await Promise.all([
		readFile(join(dir, "evalite.json"), "utf8"),
		readFile(join(dir, "manifest.json"), "utf8"),
	]);
	return {
		summaries: toCaseSummaries(JSON.parse(evaliteRaw) as ExportedOutput),
		manifest: JSON.parse(manifestRaw) as Manifest,
	};
}

function fmtRate(r: number): string {
	return `${Math.round(r * 100)}%`;
}

function histDelta(
	base: Record<string, number>,
	cand: Record<string, number>,
): string {
	const codes = new Set([...Object.keys(base), ...Object.keys(cand)]);
	const parts: string[] = [];
	for (const code of codes) {
		const b = base[code] ?? 0;
		const c = cand[code] ?? 0;
		if (b !== c) parts.push(`${code}: ${b}→${c}`);
	}
	return parts.length === 0 ? "—" : parts.join("; ");
}

const REGRESSION_PP = 0.1;

async function main(): Promise<void> {
	const [baselineDir, candidateDir] = process.argv.slice(2);
	if (baselineDir === undefined || candidateDir === undefined) {
		console.error("用法：compare <baselineDir> <candidateDir>（results/ 下的两个目录）");
		process.exit(2);
	}
	const [baseline, candidate] = await Promise.all([
		loadRunDir(baselineDir),
		loadRunDir(candidateDir),
	]);

	const lines: string[] = [];
	const b = baseline.manifest;
	const c = candidate.manifest;
	lines.push("# Eval 对比报告", "");
	lines.push(`- baseline：\`${b.tag}\` @ ${b.git.sha.slice(0, 8)}（${b.created_at}）`);
	lines.push(`- candidate：\`${c.tag}\` @ ${c.git.sha.slice(0, 8)}（${c.created_at}）`);
	lines.push(
		`- 指纹变化：prompt ${b.promptSha256 === c.promptSha256 ? "无" : "**有**"} / tool schema ${b.toolSchemaSha256 === c.toolSchemaSha256 ? "无" : "**有**"} / model ${b.model.model === c.model.model ? "无" : "**有**"} / case 集 ${b.caseSetSha256 === c.caseSetSha256 ? "无" : "**有**"}`,
		"",
	);
	lines.push(
		"| case | baseline | candidate | ΔpassRate | avgTurns | 错误码变化 | 红线 |",
		"| --- | --- | --- | --- | --- | --- | --- |",
	);

	const names = [...new Set([...baseline.summaries.keys(), ...candidate.summaries.keys()])].sort();
	let redLines = 0;
	for (const name of names) {
		const bs = baseline.summaries.get(name);
		const cs = candidate.summaries.get(name);
		if (bs === undefined || cs === undefined) {
			lines.push(`| ${name} | ${bs ? fmtRate(bs.passRate) : "（缺失）"} | ${cs ? fmtRate(cs.passRate) : "（新增/缺失）"} | — | — | — | ⚠️ 仅一侧存在 |`);
			continue;
		}
		const drop = bs.passRate - cs.passRate;
		const newArgsInvalid =
			(bs.errorHistogram["TOOL_ARGUMENTS_INVALID"] ?? 0) === 0 &&
			(cs.errorHistogram["TOOL_ARGUMENTS_INVALID"] ?? 0) >= 2;
		const red = drop > REGRESSION_PP || newArgsInvalid;
		if (red) redLines++;
		lines.push(
			`| ${name} | ${fmtRate(bs.passRate)}（${bs.runsAllPassed}/${bs.runsTotal}） | ${fmtRate(cs.passRate)}（${cs.runsAllPassed}/${cs.runsTotal}） | ${drop === 0 ? "±0pp" : `${drop > 0 ? "-" : "+"}${Math.round(Math.abs(drop) * 100)}pp`} | ${bs.avgTurns.toFixed(1)}→${cs.avgTurns.toFixed(1)} | ${histDelta(bs.errorHistogram, cs.errorHistogram)} | ${red ? "🔴" : "✅"} |`,
		);
	}

	lines.push("");
	lines.push(
		redLines === 0
			? "**结论：无回归红线**（passRate 降幅 ≤10pp 且无新增系统性 TOOL_ARGUMENTS_INVALID）"
			: `**结论：${redLines} 个 case 触发回归红线**（降幅 >10pp 或新增系统性 TOOL_ARGUMENTS_INVALID）`,
	);

	const report = lines.join("\n");
	const reportPath = join(candidateDir, "compare.md");
	await writeFile(reportPath, report, "utf8");
	console.log(report);
	console.log(`\n报告已写入：${reportPath}`);
	if (redLines > 0) process.exitCode = 1;
}

await main();
