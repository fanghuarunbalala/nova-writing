/**
 * LLM-as-judge（PRD §3.7 + evals-书库真实评测 F5 判定面泛化）：
 * 底层 judgeText 判任意载荷（最终回复 / 工具参数 / …），支持 reference 参考原文
 * （参照而非标准答案——判贴合/合理/不照抄）；judgeFinalReply 为最终回复便捷形态。
 * 独立 judge 调用（与会话 provider 同源配置，模型可经 NOVEL_EVAL_JUDGE_MODEL 单独指定），
 * 固定模板要求结构化输出 {pass, score, reason}；调用/解析失败按不过计（不静默跳过）。
 */
import { createProvider } from "@novel/core";
import type { Provider, ProviderConfig } from "@novel/core";
import { resolveEvalProviderConfig } from "./runner.js";

export interface JudgeInput {
	/** 任务原文（多消息拼接，供 judge 理解语境） */
	task: string;
	finalReply: string;
	/** 自然语言判定标准 */
	rubric: string;
	/** 参考原文（F5 扩展：原书对应内容；评分形态=参照而非标准答案） */
	reference?: string;
	/** judge 模型（缺省 NOVEL_EVAL_JUDGE_MODEL → NOVEL_EVAL_MODEL → deepseek-v4-flash） */
	model?: string;
	/** 提供时改按 score ≥ scoreAtLeast 判过（缺省按 pass === true） */
	scoreAtLeast?: number;
}

/** judgeText 输入（判定面泛化：payload 为任意被判文本） */
export interface JudgeTextInput {
	task?: string;
	/** 载包名（模板段标题，如「最终回复」「NovelWrite 参数」） */
	payloadLabel: string;
	payload: string;
	rubric: string;
	reference?: string;
	model?: string;
	scoreAtLeast?: number;
}

export interface JudgeVerdict {
	passed: boolean;
	score: number;
	reason: string;
}

const JUDGE_SYSTEM =
	"你是评测判定器。依据「判定标准」评估「待判内容」是否达标。" +
	'只输出一个 JSON 对象，不要输出任何其他内容：{"pass": boolean, "score": 0到1的数字, "reason": "简短中文理由"}';

function truncate(s: string, max = 200): string {
	return s.length <= max ? s : `${s.slice(0, max)}…`;
}

let cachedProvider: { config: string; provider: Provider } | undefined;

function getJudgeProvider(config: ProviderConfig): Provider {
	const key = JSON.stringify(config);
	if (cachedProvider?.config === key) return cachedProvider.provider;
	const provider = createProvider(config);
	cachedProvider = { config: key, provider };
	return provider;
}

export async function judgeText(input: JudgeTextInput): Promise<JudgeVerdict> {
	try {
		const provider = getJudgeProvider(resolveEvalProviderConfig());
		const sections = [
			...(input.task !== undefined ? [`# 任务\n${input.task}`] : []),
			`# ${input.payloadLabel}\n${input.payload}`,
			...(input.reference !== undefined
				? [`# 参考原文\n${truncate(input.reference, 4000)}`]
				: []),
			`# 判定标准\n${input.rubric}`,
		];
		const user = sections.join("\n\n");
		const model =
			input.model ??
			process.env.NOVEL_EVAL_JUDGE_MODEL ??
			process.env.NOVEL_EVAL_MODEL ??
			"deepseek-v4-flash";
		const result = await provider.call({
			system: JUDGE_SYSTEM,
			messages: [{ role: "user", content: user }],
			sampling: { model, temperature: 0, maxTokens: 512 },
		});
		const json = /\{[\s\S]*\}/.exec(result.message.content);
		if (json === null) {
			return {
				passed: false,
				score: 0,
				reason: `judge 输出非 JSON：${truncate(result.message.content)}`,
			};
		}
		const parsed = JSON.parse(json[0]) as {
			pass?: unknown;
			score?: unknown;
			reason?: unknown;
		};
		const score =
			typeof parsed.score === "number"
				? parsed.score
				: parsed.pass === true
					? 1
					: 0;
		const passed =
			input.scoreAtLeast !== undefined ? score >= input.scoreAtLeast : parsed.pass === true;
		return {
			passed,
			score,
			reason:
				typeof parsed.reason === "string"
					? truncate(parsed.reason)
					: "(judge 未给理由)",
		};
	} catch (e) {
		return {
			passed: false,
			score: 0,
			reason: `judge 调用失败：${e instanceof Error ? e.message : String(e)}`,
		};
	}
}

/** finalReplyJudge 的实现（判定面 = 最终回复；reference 透传） */
export async function judgeFinalReply(input: JudgeInput): Promise<JudgeVerdict> {
	return judgeText({
		task: input.task,
		payloadLabel: "最终回复",
		payload: input.finalReply,
		rubric: input.rubric,
		...(input.reference !== undefined ? { reference: input.reference } : {}),
		...(input.model !== undefined ? { model: input.model } : {}),
		...(input.scoreAtLeast !== undefined ? { scoreAtLeast: input.scoreAtLeast } : {}),
	});
}
