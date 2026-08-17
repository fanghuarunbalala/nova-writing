/** case 11 易混淆对（文档 vs 正文）：分析笔记 → 工作区 Write；小说正文 → NovelWrite kind=paragraph */
import type { CaseSpec } from "../src/compile.js";
import { jsonSubset } from "../src/matcher.js";
import { storyUnit } from "./seeds.js";
import { listOf } from "../src/snapshot-view.js";

export const spec: CaseSpec = {
	name: "file-vs-novel-dual-write",
	input: {
		task: "做两件事：1) 把「林默人物小传」写成一份分析笔记，保存到工作区文件 notes/linmo.md（这是分析笔记，不是小说正文）；2) 以「雨夜」为题，在大纲单元 su_main 下写三段小说开场正文。用工具完成。",
		repeats: 3,
		seed: { novel: [storyUnit("su_main", "主线")] },
	},
	configure: (b) =>
		b
			.toolHasCalled("Write")
			.file("notes/linmo.md", (content) => content.includes("林默"))
			.toolArgs("NovelWrite", jsonSubset({ kind: "paragraph" }))
			.store((s) =>
				listOf<{ storyUnitId?: string }>(s.paragraphs).filter((p) => p.storyUnitId === "su_main")
					.length >= 3)
			.threshold(2 / 3),
};
