/** case 3 章节创建 + 段落正文写入：paragraph 批量插入 → chapter 按序挂 paragraphIds 链 */
import type { CaseSpec } from "../src/compile.js";
import { jsonSubset } from "../src/matcher.js";
import { storyUnit } from "./seeds.js";
import { listOf, publicationOf } from "../src/snapshot-view.js";

export const spec: CaseSpec = {
	name: "chapter-paragraph-write",
	input: {
		task: "在大纲单元 su_main 下写入三段开场正文（雨夜追杀的桥段，内容你自己写）。然后创建章节「第一章 雨夜」，并把这三段按顺序挂到该章节下。用工具完成。",
		repeats: 3,
		seed: { novel: [storyUnit("su_main", "主线", { scope: "sequence" })] },
	},
	configure: (b) =>
		b
			.toolCallCount("NovelWrite", { min: 2, max: 5 })
			.toolArgs("NovelWrite", jsonSubset({ kind: "paragraph" }))
			.toolArgs("NovelWrite", jsonSubset({ kind: "chapter", values: [{ title: "第一章 雨夜" }] }))
			.store((s) => {
				const paragraphs = listOf<{ storyUnitId?: string }>(s.paragraphs).filter(
					(p) => p.storyUnitId === "su_main",
				);
				const ch = publicationOf(s).chapters.find((c) => c.title === "第一章 雨夜");
				return paragraphs.length >= 3 && ch !== undefined && (ch.paragraphIds?.length ?? 0) >= 3;
			})
			.threshold(2 / 3),
};
