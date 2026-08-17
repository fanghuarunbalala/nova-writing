/** case 7 删除链路：先读拿版本，NovelDelete kind=character，终态角色消失 */
import type { CaseSpec } from "../src/compile.js";
import { jsonSubset } from "../src/matcher.js";
import { character } from "./seeds.js";
import { listOf } from "../src/snapshot-view.js";

export const spec: CaseSpec = {
	name: "delete-character",
	input: {
		task: "删除角色林默。删除前先读他的档案拿到当前版本号。用工具完成。",
		repeats: 3,
		seed: { novel: [character("char_linmo", "林默", { summary: "来历不明的剑客" })] },
	},
	configure: (b) =>
		b
			.toolHasCalled("NovelRead")
			.toolArgs("NovelDelete", jsonSubset({ values: [{ kind: "character", id: "char_linmo" }] }))
			.anyToolError({ max: 0 })
			.store((s) => listOf(s.characters).length === 0),
};
