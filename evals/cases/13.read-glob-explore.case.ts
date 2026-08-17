/** case 13 Read/Glob 探索：seed 工作区设定文件，模型须先探索后建档 */
import type { CaseSpec } from "../src/compile.js";
import { jsonSubset } from "../src/matcher.js";
import { listOf } from "../src/snapshot-view.js";

export const spec: CaseSpec = {
	name: "read-glob-explore",
	input: {
		task: "先看看工作区里有哪些文件，读一读设定文件，然后创建一个角色：青云客栈的掌柜钱多多，他的设定要贴合设定文件里的世界规则（比如提到货币时用对单位）。用工具完成。",
		repeats: 3,
		seed: {
			files: {
				"设定/世界观.md":
					"# 世界观\n\n- 本作货币单位为「刀」，一贯等于一百刀。\n- 江湖门派以「楼」「阁」命名，不叫「派」。",
			},
		},
	},
	configure: (b) =>
		b
			.toolHasCalled("Glob")
			.toolHasCalled("Read")
			.toolArgs("NovelWrite", jsonSubset({ kind: "character", values: [{ name: "钱多多" }] }))
			.store((s) => listOf<{ name?: string }>(s.characters).some((c) => c.name === "钱多多"))
			.threshold(2 / 3),
};
