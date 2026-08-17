/**
 * case 8 失败自愈（stale revision）：任务给全参数（id + 谎称 revision 3，实际 1）
 * 并明示无需重读 → 预期模型直接编辑撞 TOOL_PRECHECK_FAILED → 重读档案纠正
 * baseRevision 后落库。
 * （旧版任务不给 id——模型不读就无从编辑，顺带看到真实 revision，stale 冲突
 * 在源头被消解，守门路径永远不会发生。）
 */
import type { CaseSpec } from "../src/compile.js";
import { jsonSubset } from "../src/matcher.js";
import { character } from "./seeds.js";
import { listOf } from "../src/snapshot-view.js";

export const spec: CaseSpec = {
	name: "selfheal-stale-revision",
	input: {
		task: "角色 id 是 char_linmo，他当前 revision 是 3，把简介改为「散人」。直接基于 revision 3 修改即可，无需重新读取档案。",
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
