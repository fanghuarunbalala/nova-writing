/** case 2 大纲创建：story_unit 父子链（parentId 不能引同批 → 必须两批建） */
import type { CaseSpec } from "../src/compile.js";
import { jsonSubset } from "../src/matcher.js";
import { outlineUnits } from "../src/snapshot-view.js";

export const spec: CaseSpec = {
	name: "outline-create",
	input: {
		task: "为小说搭一个最小大纲：先创建一个 arc 级大纲单元「风起云涌」（scope=arc），再在它下面创建一个 sequence 级单元「初入江湖」（scope=sequence）。用工具完成。",
		repeats: 3,
	},
	configure: (b) =>
		b
			.toolCallCount("NovelWrite", { min: 2, max: 3 })
			.toolArgs("NovelWrite", jsonSubset({ kind: "story_unit", values: [{ title: "风起云涌" }] }))
			.anyToolError({ max: 0 })
			.store((s) => {
				const units = outlineUnits(s);
				const parent = units.find((u) => u.title === "风起云涌");
				const child = units.find((u) => u.title === "初入江湖");
				return parent !== undefined && child !== undefined && child.parentId === parent.id;
			})
			.threshold(2 / 3),
};
