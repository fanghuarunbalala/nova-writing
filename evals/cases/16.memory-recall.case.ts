/**
 * case 16 跨会话召回（PRD memory-两层记忆 §6.3）：seed 记忆 = 「会话1」埋下的偏好
 * 事实（打斗短句），新会话任务问历史要求 → 预期模型检索记忆（MemorySearch 或 Read
 * 索引后直读）并在回复中给出偏好内容。threshold 2/3。
 */
import type { CaseSpec } from "../src/compile.js";
import { memorySeedFiles } from "./memorySeeds.js";

export const spec: CaseSpec = {
	name: "memory-recall",
	input: {
		task: "我之前对打斗场面的写法提过什么要求？先查你的跨会话记忆再回答。",
		repeats: 3,
		seed: {
			files: memorySeedFiles([
				{
					name: "battle-style",
					type: "feedback",
					description: "打斗场面要短句为主",
					source: "conv_prev#3",
					content:
						"## 规则/事实\n\n打斗场面以短句为主，单句≤20字，多用动词直接推进。\n\n## Why\n\n作者嫌长句拖节奏（会话1 明确纠正过）。\n\n## How to apply\n\n战斗段落生成前先自查句长。",
				},
				{ name: "pov-preference", type: "feedback", description: "人称偏好第一人称" },
			]),
		},
	},
	configure: (b) =>
		b
			.custom((m) => {
				// 检索动作二选一：MemorySearch，或 Read 索引/主题文件（memory.index 注入引导）
				const searched = m.toolCalls.some((c) => c.name === "MemorySearch");
				const read = m.toolCalls.some(
					(c) => c.name === "Read" && typeof c.args?.file_path === "string" && (c.args.file_path as string).includes("memory/"),
				);
				return searched || read;
			})
			.finalReplyContains("短句")
			.threshold(2 / 3),
};
