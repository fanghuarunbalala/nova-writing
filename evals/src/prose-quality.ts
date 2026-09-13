/**
 * 正文创作质量参考分（case 16 判定核心，PRD §11 边界内——judge 多维参考分 + 人工评测定稿）：
 * 对提取出的 ```novel 正文按 6 个质量维度各做一次 judgeText 调用（复用 judge.ts，本文件不改它），
 * 每维得 0–1 分 + 理由，全部落盘供 human-review 转人工评测表。
 * 参考分不参与 case 的自动化 pass（人工定稿）；无 API key 或正文缺失时按「跳过」记录，
 * 不静默假装有分——结构自测（Tier 1）密闭执行不触发真实调用。
 */
import { judgeText } from "./judge.js";
import type { NovelMutation } from "@novel/core";

/** 判定维度（label 即报告展示名；rubric 为自然语言判定标准） */
export interface ProseDimension {
	key: string;
	label: string;
	rubric: string;
}

/** 六维判定标准（静态冻结；reference 由调用方按夹具注入） */
export const PROSE_DIMENSIONS: readonly ProseDimension[] = [
	{
		key: "elements",
		label: "五要素落实",
		rubric:
			"正文是否落实了任务中场景大纲的全部五要素：人物（出场与行为）、地点（环境可感）、事件（情节推进）、转折（关键变化）、情绪（氛围基调）？五要素应具体展开而非一笔带过；整要素缺失或空泛提及即扣分。",
	},
	{
		key: "styleFit",
		label: "风格贴合",
		rubric:
			"正文的语言风格是否贴合参考文风：短句成段、一句一段、段间留白；动词驱动白描、少形容词堆叠；对话极简，答话常反着说或只给半句；天气与灯火等物象承载情绪；数词精确制造可信度。出现长句堆砌、形容词泛滥、直白解说、抒情总结等相悖写法即扣分。",
	},
	{
		key: "characterConsistency",
		label: "人物一致性",
		rubric:
			"正文中人物的行为、口吻与设定是否与参考人物档案一致：沈砚话少、动作简省、以「不喝酒」闻名；阿蘅克制、话少、话里带刺但留白；裴七老练、试探、表面热络。人物做出与档案矛盾的举动（如沈砚主动寒暄、阿蘅话痨）即扣分。",
	},
	{
		key: "prose",
		label: "文笔表现",
		rubric:
			"文笔是否具体、有画面感：细节白描、动词精准、以小写大；不干瘪（空洞概述）、不堆砌（辞藻排比）、不突兀（信息生硬插入）。节奏应有变化，避免句句同长、段落等齐。",
	},
	{
		key: "aiCliche",
		label: "AI 套话抑制",
		rubric:
			"正文是否避免 AI 高频模板表达：「嘴角勾起一抹冷笑」「眼中闪过一丝精光」类万能表情句、排比煽情、四字格堆砌、万能比喻、情感贴标签（「他的心中涌起一股……」）？句式不得机械重复（句句同构）。出现两处以上即重扣。",
	},
	{
		key: "psychology",
		label: "心理真实",
		rubric:
			"内心活动与对话是否自然像人：允许短句、口语、自我矛盾、吐槽与留白；禁止说明式内心独白（「他心里想：……」）、书面抒情式心理描写、把情绪写成旁白总结。人物想什么应通过动作与选择透出，而非直接陈述。",
	},
];

/** 各维参考原文（由 case 按夹具注入；空字符串 = 该维无参考） */
export interface ProseJudgeReferences {
	/** 风格基准：style.md + excerpts.md 拼接 */
	style: string;
	/** 人物基准：entities.json 的 character.create 摘要拼接 */
	characters: string;
}

export interface ProseJudgeContext {
	/** 任务原文（judge 理解场景五要素的语境） */
	task: string;
	/** 待判正文（```novel 块提取结果） */
	text: string;
	references: ProseJudgeReferences;
}

/** 单维判定结果（score null = 未判：跳过/失败） */
export interface ProseDimensionVerdict {
	key: string;
	label: string;
	score: number | null;
	reason: string;
	skipped: boolean;
}

/** judge 是否可用（三个 key 通道任一；与 runner.resolveEvalProviderConfig 同判定） */
export function judgeEnabled(): boolean {
	return Boolean(
		process.env.NOVEL_EVAL_API_KEY ||
			process.env.NOVEL_PROVIDER_API_KEY ||
			process.env.ANTHROPIC_AUTH_TOKEN,
	);
}

/** entities.json mutations → 人物档案摘要（人物一致性维的参考原文） */
export function characterSummariesOf(mutations: readonly NovelMutation[]): string {
	return mutations
		.filter((m) => m.op === "character.create")
		.map((m) => {
			const input = (m as { input?: { name?: string; summary?: string } }).input;
			return `${input?.name ?? m.id}：${input?.summary ?? "（无摘要）"}`;
		})
		.join("\n");
}

/** 六维参考分：每维一次 judgeText 调用；无 key/正文缺失整组跳过（Tier 2 才出分） */
export async function judgeProseReferenceScores(
	ctx: ProseJudgeContext,
): Promise<{ verdicts: readonly ProseDimensionVerdict[] }> {
	const text = ctx.text.trim();
	if (text === "") {
		return {
			verdicts: PROSE_DIMENSIONS.map((d) => ({
				key: d.key,
				label: d.label,
				score: null,
				reason: "未提取到 ```novel 正文（本轮无正文可判）",
				skipped: true,
			})),
		};
	}
	if (!judgeEnabled()) {
		return {
			verdicts: PROSE_DIMENSIONS.map((d) => ({
				key: d.key,
				label: d.label,
				score: null,
				reason: "未配置 API key，参考分留待 Tier 2（suite 带 key 运行）",
				skipped: true,
			})),
		};
	}
	const referenceOf = (d: ProseDimension): string | undefined => {
		switch (d.key) {
			case "styleFit":
				return ctx.references.style;
			case "characterConsistency":
				return ctx.references.characters;
			default:
				return undefined;
		}
	};
	const verdicts: ProseDimensionVerdict[] = [];
	for (const d of PROSE_DIMENSIONS) {
		const reference = referenceOf(d);
		const verdict = await judgeText({
			task: ctx.task,
			payloadLabel: `创作正文·${d.label}`,
			payload: text,
			rubric: d.rubric,
			...(reference !== undefined && reference.trim() !== "" ? { reference } : {}),
		});
		verdicts.push({
			key: d.key,
			label: d.label,
			score: verdict.score,
			reason: verdict.reason,
			skipped: false,
		});
	}
	return { verdicts };
}

/** verdicts → 断言 actual 的 JSON 文本（human-review 从 evalite.json 反向解析） */
export function verdictsToActual(verdicts: readonly ProseDimensionVerdict[]): string {
	return JSON.stringify({
		dimensions: verdicts.map((v) => ({
			label: v.label,
			score: v.score,
			reason: v.reason,
			skipped: v.skipped,
		})),
	});
}
