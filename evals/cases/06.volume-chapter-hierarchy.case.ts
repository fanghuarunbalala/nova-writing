/** case 6 卷-章层级：chapter.volumeId 归到正确卷 */
import type { CaseSpec } from "../src/compile.js";
import { jsonSubset } from "../src/matcher.js";
import { publicationOf } from "../src/snapshot-view.js";

export const spec: CaseSpec = {
	name: "volume-chapter-hierarchy",
	input: {
		task: "创建第一卷「卷一 江湖风雨」，然后在该卷下创建一章「楔子」。用工具完成。",
		repeats: 3,
	},
	configure: (b) =>
		b
			.toolArgs("NovelWrite", jsonSubset({ kind: "volume", values: [{ title: "卷一 江湖风雨" }] }))
			.store((s) => {
				const pub = publicationOf(s);
				const vol = pub.volumes.find((v) => v.title === "卷一 江湖风雨");
				const ch = pub.chapters.find((c) => c.title === "楔子");
				return vol !== undefined && ch !== undefined && ch.volumeId === vol.id;
			})
			.threshold(2 / 3),
};
