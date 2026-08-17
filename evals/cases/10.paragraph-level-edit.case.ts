/**
 * case 10 易混淆对（段落级修改）：只允许 NovelEdit kind=paragraph 命中目标段，
 * 不许删段重插、不许动其他段——终态三段且仅第二段被替换。
 */
import type { CaseSpec } from "../src/compile.js";
import { jsonSubset } from "../src/matcher.js";
import { paragraph, storyUnit } from "./seeds.js";
import { listOf } from "../src/snapshot-view.js";

export const spec: CaseSpec = {
	name: "paragraph-level-edit",
	input: {
		task: "把大纲单元 su_main 里的第二段正文（「他提着灯走过长街…」那段）整体替换为：「他忽然停住脚步，灯芯在风里晃了一下。」只改这一段，其他段落保持原样。用工具完成。",
		repeats: 3,
		seed: {
			novel: [
				storyUnit("su_main", "主线"),
				paragraph("para_1", "su_main", "雨落在青石板上，溅起细碎的水花。"),
				paragraph("para_2", "su_main", "他提着灯走过长街，脚步声在巷子里回荡。"),
				paragraph("para_3", "su_main", "远处传来更夫的梆子声，三更了。"),
			],
		},
	},
	configure: (b) =>
		b
			.toolArgs("NovelEdit", jsonSubset({ kind: "paragraph", values: [{ id: "para_2" }] }))
			.toolCallCount("NovelDelete", { max: 0 })
			.store((s) => {
				const paragraphs = listOf<{ id: string; text: string }>(s.paragraphs);
				const p1 = paragraphs.find((p) => p.id === "para_1");
				const p2 = paragraphs.find((p) => p.id === "para_2");
				const p3 = paragraphs.find((p) => p.id === "para_3");
				return (
					paragraphs.length === 3 &&
					p2?.text === "他忽然停住脚步，灯芯在风里晃了一下。" &&
					p1?.text.includes("青石板") === true &&
					p3?.text.includes("梆子声") === true
				);
			})
			.threshold(2 / 3),
};
