/**
 * case 14 AskUserQuestion：信息不足时提问而非瞎猜；askScript 以自由文本应答
 * （selections 空 + text 为合法答案形态），应答内容须回显给模型并据此建档。
 */
import type { CaseSpec } from "../src/compile.js";
import { contains } from "../src/matcher.js";
import { listOf } from "../src/snapshot-view.js";

export const spec: CaseSpec = {
	name: "ask-user-question",
	input: {
		task: "创建一个新角色，但角色的名字和身份我现在不直接告诉你——你先问我（一次问清楚），问完再建。用工具完成。",
		repeats: 3,
		askScript: [
			{
				question: "（占位，运行时以实际提问覆写）",
				selections: [],
				text: "叫沈青梧，女捕快，冷静寡言，观察力极强。",
			},
		],
	},
	configure: (b) =>
		b
			.toolHasCalled("AskUserQuestion")
			.toolResponse("AskUserQuestion", contains("沈青梧"))
			.store((s) => listOf<{ name?: string }>(s.characters).some((c) => c.name === "沈青梧"))
			.threshold(2 / 3),
};
