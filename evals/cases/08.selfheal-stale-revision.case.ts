/**
 * case 8 失败自愈（stale revision）：任务文本谎称 revision 3（实际 1）→
 * 预期撞 TOOL_PRECHECK_FAILED → 模型重读档案纠正 baseRevision 后落库。
 */
import type { CaseSpec } from "../src/compile.js";
import { jsonSubset } from "../src/matcher.js";
import { character } from "./seeds.js";
import { listOf } from "../src/snapshot-view.js";

export const spec: CaseSpec = {
	name: "selfheal-stale-revision",
	input: {
		task: "把角色林默的简介改为「散人」。他当前 revision 是 3，直接基于 revision 3 改。",
		repeats: 3,
		seed: { novel: [character("char_linmo", "林默")] },
	},
	configure: (b) =>
		b
			.toolHasCalled("NovelRead")
			.anyToolError({ code: "TOOL_PRECHECK_FAILED", min: 1, max: 2 })
			.toolResponse("NovelEdit", jsonSubset({ items: [{ status: "applied" }] }))
			.store((s) =>
				listOf<{ id: string; summary?: string }>(s.characters)
					.find((c) => c.id === "char_linmo")
					?.summary === "散人")
			.threshold(2 / 3),
};
