/** case 4 读后改：先 NovelRead 拿 entityVersion，再 NovelEdit 带正确 baseRevision */
import type { CaseSpec } from "../src/compile.js";
import { jsonSubset } from "../src/matcher.js";
import { character } from "./seeds.js";
import { listOf } from "../src/snapshot-view.js";

export const spec: CaseSpec = {
	name: "read-then-edit-character",
	input: {
		task: "把角色林默的简介（summary）改为「北境流亡的剑客」。修改前先读他的最新档案确认当前版本。用工具完成。",
		repeats: 3,
		seed: { novel: [character("char_linmo", "林默", { summary: "来历不明的剑客" })] },
	},
	configure: (b) =>
		b
			.toolHasCalled("NovelRead")
			.toolArgs("NovelRead", jsonSubset({ kind: "character" }))
			.toolArgs("NovelEdit", jsonSubset({ kind: "character", values: [{ id: "char_linmo", baseRevision: 1 }] }))
			.anyToolError({ max: 0 })
			.store((s) =>
				listOf<{ id: string; summary?: string }>(s.characters)
					.find((c) => c.id === "char_linmo")
					?.summary === "北境流亡的剑客"),
};
