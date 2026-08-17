/** case 1 角色创建：NovelWrite kind=character 基本面 */
import type { CaseSpec } from "../src/compile.js";
import { jsonSubset } from "../src/matcher.js";
import { listOf } from "../src/snapshot-view.js";

export const spec: CaseSpec = {
	name: "character-create",
	input: {
		task: "为我的小说创建一个角色：主角叫林默，是一名剑客，气质散漫但出剑极快。用工具完成。",
		repeats: 3,
	},
	configure: (b) =>
		b
			.toolHasCalled("NovelWrite")
			.toolArgs("NovelWrite", jsonSubset({ kind: "character", values: [{ name: "林默" }] }))
			.anyToolError({ code: "TOOL_ARGUMENTS_INVALID", max: 0 })
			.turns({ max: 8 })
			.finalReplyContains("林默")
			.store((s) => listOf<{ name?: string }>(s.characters).some((c) => c.name === "林默")),
};
