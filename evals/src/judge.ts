/**
 * LLM-as-judge（PRD §3.7）：finalReplyJudge 的实现。
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
	/** judge 模型（缺省 NOVEL_EVAL_JUDGE_MODEL → NOVEL_EVAL_MODEL → deepseek-v4-flash） */
	model?: string;
	/** 提供时改按 score ≥ scoreAtLeast 判过（缺省按 pass === true） */
	scoreAtLeast?: number;
}

export interface JudgeVerdict {
	passed: boolean;
	score: number;
	reason: string;
}

const JUDGE_SYSTEM =
	"你是评测判定器。依据「判定标准」评估「最终回复」是否达标。" +
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

export async function judgeFinalReply(input: JudgeInput): Promise<JudgeVerdict> {
	try {
		const provider = getJudgeProvider(resolveEvalProviderConfig());
		const user =
			`# 任务\n${input.task}\n\n# 最终回复\n${input.finalReply}\n\n# 判定标准\n${input.rubric}`;
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
			input.scoreAtLeast !== undefined
				? score >= input.scoreAtLeast
				: parsed.pass === true;
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
