/**
 * 结果可视化报告：读单个 results 目录的 evalite.json + manifest.json，渲染自包含
 * 单文件 report.html（零外部依赖、离线可分发；风格对齐 docs/design/app-redesign-demo.html
 * 的 L2/L3 设计令牌，主题：宣纸白/墨夜/黛青/雪青）。
 * 服务端全量拼接（无 JS 也可读全内容），内嵌少量原生 JS 只做增强：主题切换、case 筛选。
 *
 * 用法：pnpm --filter @novel/evals report -- results/<目录>
 * suite 落盘 manifest 后亦自动生成同目录 report.html（见 suite.ts）。
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EvalRunMetrics, ToolCallTrace } from "./types.js";
import { listOf, outlineUnits, publicationOf } from "./snapshot-view.js";

interface ReportManifest {
	tag: string;
	created_at: string;
	git: { sha: string; branch: string };
	promptSha256: string;
	toolSchemaSha256: string;
	toolCount: number;
	model: { baseUrl: string; model: string; judgeModel: string | null; temperature: number };
	caseFiles: string[];
	caseSetSha256: string;
	/** 夹具归因（F7；旧报告无此字段） */
	fixtures?: Array<{ alias: string; sha256: string }>;
}

/** evalite --outputPath 导出结构（Evalite.Exported.Output）中本工具消费的子集（全量 trial 细节） */
interface ExportedEvalite {
	evals: Array<{
		name: string;
		filepath?: string;
		duration?: number;
		averageScore: number;
		results: Array<{
			duration?: number;
			input?: { task?: string | string[] };
			output: Partial<EvalRunMetrics> | null;
			scores: Array<{ name?: string; score: number }>;
		}>;
	}>;
}

type Trial = ExportedEvalite["evals"][number]["results"][number];

/* ---------------- 基础工具 ---------------- */

function esc(s: unknown): string {
	return String(s ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function pct(x: number): string {
	return `${Math.round(x * 100)}%`;
}

function fmtMs(ms: number): string {
	return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function fmtTokens(n: number): string {
	return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function trialPassed(t: Trial): boolean {
	return t.scores.length > 0 && t.scores.every((s) => s.score === 1);
}

/** trial 得分 = 其断言得分均值（无断言记 0；与 compare 的严格全过口径区分、仅用于展示） */
function trialScore(t: Trial): number {
	if (t.scores.length === 0) return 0;
	return t.scores.reduce((a, s) => a + s.score, 0) / t.scores.length;
}

function taskText(t: Trial): string {
	const task = t.input?.task;
	if (Array.isArray(task)) {
		return task.map((line, i) => `${i === 0 ? "" : "⏎ "}${line}`).join("\n");
	}
	return task ?? "（无任务文本）";
}

function oneLine(s: unknown, max = 120): string {
	const t = String(s ?? "").replace(/\s+/g, " ").trim();
	return t.length > max ? `${t.slice(0, max)}…` : t;
}

/* ---------------- 视图片段 ---------------- */

/** canonical 写工具暖色、compose/提问门 info、TodoWrite success——与产品语义一致的工具着色 */
const TOOL_TONE: Record<string, string> = {
	NovelWrite: "write",
	NovelEdit: "write",
	NovelDelete: "write",
	Write: "write",
	Edit: "write",
	EnterComposeMode: "gate",
	ExitComposeMode: "gate",
	AskUserQuestion: "gate",
	TodoWrite: "todo",
};

function toolChip(name: string): string {
	const tone = TOOL_TONE[name] ?? "read";
	return `<span class="tChip ${tone}">${esc(name)}</span>`;
}

function scorePill(score: number): string {
	const cls = score === 1 ? "ok" : score >= 0.5 ? "warn" : "bad";
	return `<span class="pill ${cls}">${pct(score)}</span>`;
}

function renderCall(c: ToolCallTrace): string {
	const argsJson = esc(JSON.stringify(c.args ?? c.argsRaw, null, 2));
	const head = `<div class="callRow"><span class="turn">T${c.turn}</span>${toolChip(c.name)}<span class="dur">${fmtMs(c.durationMs)}</span>`;
	if (c.error !== undefined) {
		return `${head}<span class="callErr">${esc(c.error.code)}：${oneLine(c.error.message)}</span></div>`;
	}
	const result = c.result ?? "";
	return `${head}<details class="sub"><summary>args · ${esc(oneLine(c.argsRaw))}</summary><pre>${argsJson}</pre></details>` +
		`<details class="sub"><summary>result · ${esc(oneLine(result))}</summary><pre>${esc(result)}</pre></details></div>`;
}

/** 终态快照 overview.counts 的键 → 中文标签（顺序即展示序） */
const STORE_COUNT_LABELS: Array<[string, string]> = [
	["characters", "角色"],
	["locations", "地点"],
	["storyUnits", "单元"],
	["volumes", "卷"],
	["chapters", "章"],
	["paragraphs", "段落"],
];

function renderStore(m: Partial<EvalRunMetrics>): string {
	const s = m.storeSnapshot;
	if (s === null || s === undefined) {
		return `<div class="faint">（无终态快照）</div>`;
	}
	const ov = s.overview as { title?: string; counts?: Record<string, number> } | null;
	const counts = ov?.counts ?? {};
	const countChips: string[] = STORE_COUNT_LABELS.filter(([k]) => (counts[k] ?? 0) > 0)
		.map(([k, label]) => `<span class="pill mono">${label} ${counts[k] ?? 0}</span>`);
	const entityChips = [
		...listOf<{ name?: string }>(s.characters).slice(0, 12),
		...listOf<{ name?: string }>(s.locations).slice(0, 12),
	]
		.map((e) => `<span class="pill">${esc(e.name ?? "?")}</span>`)
		.join("");
	const units = outlineUnits(s);
	const pub = publicationOf(s);
	const parts: string[] = [];
	if (ov?.title !== undefined && ov.title !== "未命名小说") {
		parts.push(`<span class="faint">《${esc(ov.title)}》</span>`);
	}
	parts.push(countChips.join(" "), entityChips);
	if (units.length > 0) parts.push(`<span class="pill mono">大纲单元 ${units.length}</span>`);
	if (pub.volumes.length > 0 || pub.chapters.length > 0) {
		parts.push(`<span class="pill mono">出版结构 ${pub.volumes.length} 卷 / ${pub.chapters.length} 章</span>`);
	}
	const fileNames = Object.keys(m.files ?? {});
	if (fileNames.length > 0) {
		const fileDetails = fileNames
			.map(
				(f) =>
					`<details class="sub"><summary>${esc(f)}</summary><pre>${esc(m.files?.[f] ?? "")}</pre></details>`,
			)
			.join("");
		parts.push(`<div class="fileBlock"><span class="faint">工作区文件 ${fileNames.length}</span>${fileDetails}</div>`);
	}
	const html = parts.filter((p) => p.trim() !== "").join(" ");
	return html === "" ? `<div class="faint">（空库）</div>` : `<div class="chips">${html}</div>`;
}

function renderTrial(t: Trial, idx: number): string {
	const m = t.output;
	const pass = trialPassed(t);
	const scoreRows = t.scores
		.map(
			(s) =>
				`<div class="scoreRow ${s.score === 1 ? "ok" : "bad"}"><span class="mark">${s.score === 1 ? "✓" : "✗"}</span><span class="scoreName">${esc(s.name ?? "?")}</span><span class="pill ${s.score === 1 ? "ok" : "bad"}">${pct(s.score)}</span></div>`,
		)
		.join("");
	const errBlocks = (m?.toolErrors ?? [])
		.map(
			(e) =>
				`<div class="errBlock"><span class="pill bad mono">${esc(e.code)}</span> ${toolChip(e.toolName)}<div class="errMsg">${esc(e.message)}</div></div>`,
		)
		.join("");
	// 护栏终止块（F4：rule 归因置顶）
	const abortBlock =
		m?.abort !== undefined
			? `<div class="errBlock"><span class="pill bad mono">护栏 ${esc(m.abort.rule)}</span> @T${m.abort.turn}<div class="errMsg">${esc(m.abort.detail)}</div></div>`
			: "";
	// 引用有效率与书库调用序列（F7）
	const citationPill =
		m?.citations !== undefined
			? `<span class="pill mono ${m.citations.valid.length === m.citations.cited.length ? "ok" : "bad"}">引用 ${m.citations.valid.length}/${m.citations.cited.length}</span>`
			: "";
	const libraryLine =
		m?.libraryCalls !== undefined && m.libraryCalls.length > 0
			? `<div class="chips"><span class="faint">书库调用</span>${m.libraryCalls
					.map(
						(c) =>
							`<span class="pill mono ${c.error !== undefined ? "bad" : ""}">${esc(c.kind)}</span>`,
					)
					.join("")}</div>`
			: "";
	const usage =
		m?.usage !== undefined
			? `<span class="pill mono">in ${fmtTokens(m.usage.inputTokens)} · out ${fmtTokens(m.usage.outputTokens)}</span>`
			: "";
	const time = m?.times !== undefined ? `<span class="pill mono">${fmtMs(m.times.totalMs)}</span>` : "";
	const turns = `<span class="pill mono">${m?.turns ?? "?"} turns</span>`;
	const body =
		m === null || m === undefined
			? `<div class="errBlock"><span class="pill bad">run 无输出</span></div>`
			: `
	<div class="trialMeta">${turns}${time}${usage}${citationPill}</div>
	<div class="taskSay">${esc(taskText(t))}</div>
	${scoreRows === "" ? '<div class="faint">（无断言记录）</div>' : `<div class="scoreList">${scoreRows}</div>`}
	${abortBlock}
	${m.toolCalls === undefined ? '<div class="faint">（无工具调用）</div>' : `<div class="calls">${m.toolCalls.map(renderCall).join("")}</div>`}
	${errBlocks}
	${libraryLine}
	${m.final === undefined || m.final === "" ? "" : `<div class="finalSay">${esc(m.final)}</div>`}
	<div class="storeHead faint">终态快照</div>
	${renderStore(m)}`;
	return `<details class="trial" ${pass ? "" : "open"}><summary>trial ${idx + 1} ${pass ? '<span class="pill ok">全过</span>' : '<span class="pill bad">有失分</span>'}</summary><div class="trialBody">${body}</div></details>`;
}

function renderCase(ev: ExportedEvalite["evals"][number], seq: number): string {
	const dots = ev.results
		.map((t) => `<span class="dot ${trialPassed(t) ? "ok" : "bad"}">●</span>`)
		.join(" ");
	const turnsList = ev.results.map((t) => t.output?.turns).filter((v): v is number => typeof v === "number");
	const avgTurns = turnsList.length === 0 ? 0 : turnsList.reduce((a, b) => a + b, 0) / turnsList.length;
	const tokens = ev.results.reduce((a, t) => {
		const u = t.output?.usage;
		return a + (u === undefined ? 0 : u.inputTokens + u.outputTokens);
	}, 0);
	const failedScores = new Set<string>();
	for (const t of ev.results) {
		for (const s of t.scores) {
			if (s.score < 1) failedScores.add(s.name ?? "?");
		}
	}
	const failedPills = [...failedScores]
		.map((n) => `<span class="pill bad">${esc(n)}</span>`)
		.join(" ");
	const trials = ev.results.map((t, i) => renderTrial(t, i)).join("");
	return `<details class="caseCard" ${ev.averageScore === 1 ? "" : "open"} data-cat="${ev.averageScore === 1 ? "full" : "partial"}">
	<summary class="caseHead">
		<span class="seq">${String(seq).padStart(2, "0")}</span>
		<span class="caseName">${esc(ev.name)}</span>
		<span class="dots">${dots}</span>
		${scorePill(ev.averageScore)}
		<span class="pill mono">${avgTurns.toFixed(1)} turns · ${fmtTokens(tokens)} tok</span>
		${failedPills}
	</summary>
	<div class="caseBody">${trials}</div>
</details>`;
}

/* ---------------- 样式与脚本（对齐 app-redesign-demo 的令牌子集） ---------------- */

function renderStyles(): string {
	return `
:root {
  --font-ui: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI",
    "PingFang SC", "Hiragino Sans GB", "HarmonyOS Sans SC", "MiSans",
    "Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei UI", "Microsoft YaHei",
    system-ui, sans-serif;
  --font-kai: "LXGW WenKai", "Kaiti SC", "STKaiti", "KaiTi", "Noto Serif SC", serif;
  --font-mono: "SF Mono", ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace;
  --fs-12: 12px; --fs-13: 13px; --fs-11: 11px; --fs-11-5: 11.5px; --fs-10-5: 10.5px;
  --fw-regular: 400; --fw-medium: 550; --fw-semibold: 650; --fw-bold: 700;
  --radius-sm: 6px; --radius-md: 9px; --radius-lg: 14px; --radius-pill: 999px;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --color-bg:            oklch(97.9% 0.003 85);
  --color-surface:       oklch(99.8% 0.0015 85);
  --color-surface-2:     oklch(96.2% 0.004 82);
  --color-fg:            oklch(30% 0.009 46);
  --color-muted:         oklch(52% 0.009 54);
  --color-faint:         oklch(60% 0.009 58);
  --color-border:        oklch(92.4% 0.003 82);
  --color-border-strong: oklch(86.4% 0.006 72);
  --color-accent:        oklch(55% 0.072 42);
  --color-accent-ink:    oklch(47% 0.062 41);
  --color-success:       oklch(52% 0.07 156);
  --color-success-bg:    oklch(97.2% 0.011 156);
  --color-warn:          oklch(59% 0.07 80);
  --color-warn-bg:       oklch(97.1% 0.011 86);
  --color-danger:        oklch(54% 0.068 32);
  --color-danger-bg:     oklch(97.1% 0.009 33);
  --color-info:          oklch(54% 0.05 235);
  --color-info-bg:       oklch(97.2% 0.007 236);
  --color-accent-9:   color-mix(in oklab, var(--color-accent) 9%, var(--color-surface));
  --color-accent-11:  color-mix(in oklab, var(--color-accent) 11%, var(--color-surface));
  --color-accent-45:  color-mix(in oklab, var(--color-accent) 45%, transparent);
  --color-chrome-bg:  color-mix(in oklab, var(--color-surface) 82%, transparent);
  --color-selection:  color-mix(in oklab, var(--color-accent) 16%, transparent);
  --shadow-xs: 0 1px 3px rgba(20, 12, 6, 0.08);
}
[data-theme="ink"] {
  --color-bg: oklch(21% 0.005 80); --color-surface: oklch(25.5% 0.006 80);
  --color-surface-2: oklch(28.5% 0.007 78); --color-fg: oklch(89% 0.006 85);
  --color-muted: oklch(70% 0.008 80); --color-faint: oklch(59% 0.007 80);
  --color-border: oklch(31% 0.007 80); --color-border-strong: oklch(40% 0.01 78);
  --color-accent: oklch(68% 0.115 42); --color-accent-ink: oklch(78% 0.09 45);
  --color-success: oklch(72% 0.095 156); --color-success-bg: oklch(29% 0.032 156);
  --color-warn: oklch(75% 0.1 80); --color-warn-bg: oklch(29% 0.034 85);
  --color-danger: oklch(67% 0.1 32); --color-danger-bg: oklch(28% 0.03 33);
  --color-info: oklch(70% 0.075 235); --color-info-bg: oklch(28% 0.024 236);
}
[data-theme="celadon"] {
  --color-bg: oklch(20% 0.013 235); --color-surface: oklch(24% 0.015 235);
  --color-surface-2: oklch(27% 0.017 232); --color-fg: oklch(89% 0.009 225);
  --color-muted: oklch(69% 0.013 230); --color-faint: oklch(58% 0.012 230);
  --color-border: oklch(30% 0.015 235); --color-border-strong: oklch(38% 0.019 232);
  --color-accent: oklch(75% 0.1 195); --color-accent-ink: oklch(84% 0.075 205);
  --color-success: oklch(72% 0.095 158); --color-success-bg: oklch(28% 0.032 158);
  --color-warn: oklch(76% 0.1 90); --color-warn-bg: oklch(28% 0.032 88);
  --color-danger: oklch(68% 0.11 25); --color-danger-bg: oklch(28% 0.03 25);
  --color-info: oklch(72% 0.08 240); --color-info-bg: oklch(28% 0.028 240);
}
[data-theme="frost"] {
  --color-bg: oklch(97.4% 0.004 240); --color-surface: oklch(99.5% 0.002 240);
  --color-surface-2: oklch(95.6% 0.005 234); --color-fg: oklch(29% 0.016 262);
  --color-muted: oklch(50% 0.014 256); --color-faint: oklch(59% 0.012 254);
  --color-border: oklch(91.6% 0.005 240); --color-border-strong: oklch(85.4% 0.009 234);
  --color-accent: oklch(52% 0.1 262); --color-accent-ink: oklch(44% 0.09 262);
  --color-success: oklch(52% 0.07 156); --color-success-bg: oklch(96.8% 0.011 156);
  --color-warn: oklch(58% 0.07 80); --color-warn-bg: oklch(96.7% 0.011 86);
  --color-danger: oklch(54% 0.068 32); --color-danger-bg: oklch(96.7% 0.009 33);
  --color-info: oklch(54% 0.055 240); --color-info-bg: oklch(96.8% 0.008 240);
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--color-bg); color: var(--color-fg);
  font-family: var(--font-ui); font-size: var(--fs-13); line-height: 1.6;
}
::selection { background: var(--color-selection); }
.topbar {
  position: sticky; top: 0; z-index: 10;
  backdrop-filter: blur(10px); background: var(--color-chrome-bg);
  border-bottom: 1px solid var(--color-border);
}
.topbarIn { max-width: 1080px; margin: 0 auto; padding: 10px 20px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.topbar h1 { font-size: 15px; font-weight: var(--fw-bold); margin: 0; }
.wrap { max-width: 1080px; margin: 0 auto; padding: 18px 20px 60px; }
.faint { color: var(--color-faint); font-size: var(--fs-12); }
.statGrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 0 0 14px; }
.statCard { border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); padding: 10px 14px; box-shadow: var(--shadow-xs); }
.statCard .num { font-family: var(--font-mono); font-size: 21px; font-weight: var(--fw-bold); color: var(--color-accent-ink); line-height: 1.2; }
.statCard .lbl { font-size: var(--fs-11); color: var(--color-faint); }
.pill {
  display: inline-flex; align-items: center; gap: 5px; padding: 1px 10px;
  border-radius: var(--radius-pill); font-size: var(--fs-11-5);
  border: 1px solid var(--color-border); background: var(--color-surface);
}
.pill.mono { font-family: var(--font-mono); font-size: var(--fs-10-5); }
.pill.ok { color: var(--color-success); background: var(--color-success-bg); border-color: transparent; }
.pill.warn { color: var(--color-warn); background: var(--color-warn-bg); border-color: transparent; }
.pill.bad { color: var(--color-danger); background: var(--color-danger-bg); border-color: transparent; }
.metaStrip { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 16px; }
.filterBar { display: flex; gap: 8px; margin: 0 0 12px; }
button.filterBtn, button#themeBtn {
  font-family: inherit; font-size: var(--fs-11-5); padding: 3px 14px; cursor: pointer;
  border: 1px solid var(--color-border); border-radius: var(--radius-pill);
  background: var(--color-surface); color: var(--color-muted);
  transition: all 0.15s var(--ease-out);
}
button.filterBtn.on { background: var(--color-accent-11); color: var(--color-accent-ink); border-color: transparent; }
.caseCard { border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); margin: 10px 0; box-shadow: var(--shadow-xs); overflow: hidden; }
.caseHead { display: flex; align-items: center; gap: 9px; padding: 11px 16px; cursor: pointer; user-select: none; flex-wrap: wrap; list-style: none; }
.caseHead::-webkit-details-marker { display: none; }
.caseCard[open] .caseHead { border-bottom: 1px solid var(--color-border); }
.seq { font-family: var(--font-mono); font-size: var(--fs-10-5); color: var(--color-faint); }
.caseName { font-weight: var(--fw-semibold); }
.dots { letter-spacing: 3px; font-size: var(--fs-11); }
.dot.ok { color: var(--color-success); } .dot.bad { color: var(--color-danger); }
.caseBody { padding: 12px 16px 16px; background: color-mix(in oklab, var(--color-surface-2) 55%, var(--color-surface)); }
.trial { border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); margin: 8px 0; }
.trial > summary { padding: 8px 14px; cursor: pointer; display: flex; gap: 8px; align-items: center; list-style: none; }
.trial > summary::-webkit-details-marker { display: none; }
.trial > summary::before { content: "▸"; color: var(--color-faint); transition: transform 0.15s var(--ease-out); }
.trial[open] > summary::before { transform: rotate(90deg); }
.trialBody { padding: 4px 14px 14px; border-top: 1px dashed var(--color-border); }
.trialMeta { display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0; }
.taskSay {
  font-size: 12.5px; color: var(--color-muted);
  border-left: 3px solid var(--color-border-strong); padding: 2px 10px; margin: 8px 0;
  white-space: pre-wrap;
}
.scoreList { margin: 8px 0; }
.scoreRow { display: flex; gap: 8px; align-items: center; padding: 2px 0; }
.scoreRow .mark { font-weight: var(--fw-bold); width: 14px; }
.scoreRow.ok .mark { color: var(--color-success); } .scoreRow.bad .mark { color: var(--color-danger); }
.scoreName { font-family: var(--font-mono); font-size: var(--fs-11); color: var(--color-muted); flex: 1; min-width: 0; overflow-wrap: anywhere; }
.calls { margin: 6px 0; }
.callRow { display: flex; gap: 8px; align-items: baseline; padding: 5px 0; border-bottom: 1px dashed var(--color-border); flex-wrap: wrap; }
.turn { font-family: var(--font-mono); font-size: var(--fs-10-5); color: var(--color-faint); min-width: 26px; }
.dur { font-family: var(--font-mono); font-size: var(--fs-10-5); color: var(--color-faint); }
.callErr { font-family: var(--font-mono); font-size: var(--fs-10-5); color: var(--color-danger); overflow-wrap: anywhere; }
.tChip { font-family: var(--font-mono); font-size: var(--fs-11); padding: 1px 8px; border-radius: var(--radius-sm); background: var(--color-accent-11); color: var(--color-accent-ink); }
.tChip.write { background: var(--color-warn-bg); color: var(--color-warn); }
.tChip.gate { background: var(--color-info-bg); color: var(--color-info); }
.tChip.todo { background: var(--color-success-bg); color: var(--color-success); }
details.sub { margin: 3px 0 3px 34px; }
details.sub > summary { cursor: pointer; color: var(--color-faint); font-family: var(--font-mono); font-size: var(--fs-10-5); list-style: none; overflow-wrap: anywhere; }
details.sub > summary::-webkit-details-marker { display: none; }
details.sub > summary::before { content: "▸ "; }
details.sub[open] > summary::before { content: "▾ "; }
pre {
  font-family: var(--font-mono); font-size: var(--fs-11); line-height: 1.55;
  background: var(--color-surface-2); border: 1px solid var(--color-border);
  border-radius: var(--radius-sm); padding: 8px 10px; overflow: auto;
  max-height: 320px; margin: 4px 0; white-space: pre-wrap; overflow-wrap: anywhere;
}
.errBlock { border: 1px solid transparent; border-radius: var(--radius-md); background: var(--color-danger-bg); padding: 8px 12px; margin: 8px 0; }
.errMsg { font-family: var(--font-mono); font-size: var(--fs-10-5); color: var(--color-danger); margin-top: 4px; overflow-wrap: anywhere; }
.finalSay {
  font-family: var(--font-kai); font-size: 15px; line-height: 1.9;
  padding: 10px 14px; margin: 10px 0;
  border-left: 3px solid var(--color-accent-45); background: var(--color-accent-9);
  border-radius: 0 var(--radius-md) var(--radius-md) 0; white-space: pre-wrap;
}
.storeHead { margin-top: 10px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 6px 0; }
.fileBlock { width: 100%; }
footer { margin-top: 26px; }
@media print { .filterBar, #themeBtn { display: none; } .caseCard { break-inside: avoid; } }
`;
}

function renderScript(): string {
	return `
const THEMES = [["", "宣纸白"], ["ink", "墨夜"], ["celadon", "黛青"], ["frost", "雪青"]];
const btn = document.getElementById("themeBtn");
let cur = 0;
try {
  const saved = localStorage.getItem("evalReportTheme");
  const i = THEMES.findIndex((t) => t[0] === saved);
  if (i >= 0) cur = i;
} catch (e) {}
function apply() {
  document.documentElement.dataset.theme = THEMES[cur][0];
  btn.textContent = THEMES[cur][1];
  try { localStorage.setItem("evalReportTheme", THEMES[cur][0]); } catch (e) {}
}
apply();
btn.addEventListener("click", () => { cur = (cur + 1) % THEMES.length; apply(); });
document.querySelectorAll("button[data-f]").forEach((b) => {
  b.addEventListener("click", () => {
    const f = b.dataset.f;
    document.querySelectorAll(".caseCard").forEach((c) => {
      c.hidden = !(f === "all" || c.dataset.cat === f);
    });
    document.querySelectorAll("button[data-f]").forEach((x) => x.classList.toggle("on", x === b));
  });
});
`;
}

/* ---------------- 文档组装 ---------------- */

export function renderReportHtml(data: ExportedEvalite, manifest: ReportManifest): string {
	const evals = [...data.evals].sort((a, b) =>
		(a.filepath ?? a.name).localeCompare(b.filepath ?? b.name),
	);
	const trials = evals.flatMap((ev) => ev.results);
	const overall = trials.length === 0 ? 0 : trials.reduce((a, t) => a + trialScore(t), 0) / trials.length;
	const allPass = trials.filter(trialPassed).length;
	const fullCases = evals.filter((ev) => ev.averageScore === 1).length;
	const tokens = trials.reduce((a, t) => {
		const u = t.output?.usage;
		return a + (u === undefined ? 0 : u.inputTokens + u.outputTokens);
	}, 0);
	const totalMs = evals.reduce((a, ev) => a + (ev.duration ?? 0), 0);
	const errTotal = trials.reduce((a, t) => a + (t.output?.toolErrors ?? []).length, 0);
	// 护栏终止与引用有效率（F7；无数据不占卡片）
	const abortTotal = trials.reduce((a, t) => a + (t.output?.abort !== undefined ? 1 : 0), 0);
	let citedSum = 0;
	let validSum = 0;
	for (const t of trials) {
		const c = t.output?.citations;
		if (c !== undefined) {
			citedSum += c.cited.length;
			validSum += c.valid.length;
		}
	}
	const citationRate = citedSum === 0 ? null : validSum / citedSum;

	const stat = (num: string, lbl: string) =>
		`<div class="statCard"><div class="num">${num}</div><div class="lbl">${lbl}</div></div>`;
	const meta = (text: string) => `<span class="pill mono">${text}</span>`;

	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>评测报告 · ${esc(manifest.tag)} · ${esc(manifest.created_at.slice(0, 10))}</title>
<style>${renderStyles()}</style>
</head>
<body>
<header class="topbar"><div class="topbarIn">
  <h1>评测报告</h1>
  <span class="pill">${esc(manifest.tag)}</span>
  <span class="faint">${esc(manifest.created_at.replace("T", " ").slice(0, 19))}</span>
  <span style="flex:1"></span>
  <button id="themeBtn" type="button">宣纸白</button>
</div></header>
<main class="wrap">
  <div class="statGrid">
    ${stat(pct(overall), "总分（trial 断言均分）")}
    ${stat(`${fullCases}/${evals.length}`, "满分 case")}
    ${stat(`${allPass}/${trials.length}`, "trial 全过")}
    ${stat(fmtTokens(tokens), "tokens 总量")}
    ${stat(fmtMs(totalMs), "总耗时")}
    ${stat(String(errTotal), "工具错误")}
    ${abortTotal > 0 ? stat(String(abortTotal), "护栏终止") : ""}
    ${citationRate !== null ? stat(pct(citationRate), `引用有效率（${validSum}/${citedSum}）`) : ""}
  </div>
  <div class="metaStrip">
    ${meta(`git ${esc(manifest.git.sha.slice(0, 8))} (${esc(manifest.git.branch)})`)}
    ${meta(`${esc(manifest.model.model)} · T=${manifest.model.temperature}`)}
    ${manifest.model.judgeModel !== null ? meta(`judge ${esc(manifest.model.judgeModel)}`) : ""}
    ${meta(`tools ${manifest.toolCount}`)}
    ${meta(`prompt ${manifest.promptSha256.slice(0, 8)}`)}
    ${meta(`schema ${manifest.toolSchemaSha256.slice(0, 8)}`)}
    ${meta(`caseSet ${manifest.caseSetSha256.slice(0, 8)}`)}
    ${manifest.fixtures !== undefined && manifest.fixtures.length > 0 ? meta(`fixtures ${manifest.fixtures.map((f) => `${esc(f.alias)}@${f.sha256.slice(0, 6)}`).join(" ")}`) : ""}
  </div>
  <div class="filterBar">
    <button class="filterBtn on" data-f="all" type="button">全部 ${evals.length}</button>
    <button class="filterBtn" data-f="partial" type="button">失分 ${evals.length - fullCases}</button>
    <button class="filterBtn" data-f="full" type="button">满分 ${fullCases}</button>
  </div>
  ${evals.map((ev, i) => renderCase(ev, i + 1)).join("\n")}
  <footer class="faint">由 @novel/evals report 生成 · 风格令牌取自 docs/design/app-redesign-demo.html（宣纸白/墨夜/黛青/雪青）</footer>
</main>
<script>${renderScript()}</script>
</body>
</html>
`;
}

/** 读 results 目录（evalite.json + manifest.json）→ 写同目录 report.html，返回报告路径 */
export async function writeReport(dir: string): Promise<string> {
	const [evaliteRaw, manifestRaw] = await Promise.all([
		readFile(join(dir, "evalite.json"), "utf8"),
		readFile(join(dir, "manifest.json"), "utf8"),
	]);
	const html = renderReportHtml(
		JSON.parse(evaliteRaw) as ExportedEvalite,
		JSON.parse(manifestRaw) as ReportManifest,
	);
	const reportPath = join(dir, "report.html");
	await writeFile(reportPath, html, "utf8");
	return reportPath;
}

async function main(): Promise<void> {
	// pnpm 透传时 "--" 分隔符会原样出现在 argv 里，一并滤除
	const dir = process.argv.slice(2).filter((a) => a !== "--")[0];
	if (dir === undefined) {
		console.error("用法：report <resultsDir>（results/ 下的运行目录）");
		process.exit(2);
	}
	const reportPath = await writeReport(dir);
	console.log(`[report] 报告已生成：${reportPath}`);
}

// CLI 入口守卫：report.js 被 suite.js import（writeReport）时不得触发顶层 main
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
	await main();
}
