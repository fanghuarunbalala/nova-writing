/** case 12 TodoWrite 使用：多步任务先列计划再推进，todo 至少更新一轮 */
import type { CaseSpec } from "../src/compile.js";
import { storyUnit } from "./seeds.js";
import { listOf } from "../src/snapshot-view.js";

export const spec: CaseSpec = {
	name: "todo-usage",
	input: {
		task: "依次完成三件事：创建角色林默（剑客）、创建地点青云客栈、在大纲单元 su_main 下写一段正文。开始前先用 TodoWrite 列出计划，并在过程中更新状态。用工具完成。",
		repeats: 3,
		seed: { novel: [storyUnit("su_main", "主线")] },
	},
	configure: (b) =>
		b
			.toolCallCount("TodoWrite", { min: 2, max: 8 })
			.store((s) => {
				const hasChar = listOf<{ name?: string }>(s.characters).some((c) => c.name === "林默");
				const hasLoc = listOf<{ name?: string }>(s.locations).some((l) => l.name === "青云客栈");
				const hasPara = listOf<{ storyUnitId?: string }>(s.paragraphs).some(
					(p) => p.storyUnitId === "su_main",
				);
				return hasChar && hasLoc && hasPara;
			})
			.threshold(2 / 3),
};
