/** case 5 批量地点创建：一次 NovelWrite 批量 values ≥3 */
import type { CaseSpec } from "../src/compile.js";
import { jsonSubset } from "../src/matcher.js";
import { listOf } from "../src/snapshot-view.js";

export const spec: CaseSpec = {
	name: "batch-location-create",
	input: {
		task: "一次性创建三个地点：青云客栈（城中最热闹的客栈）、落雁渡口（城南水路要冲）、听雨楼（茶楼兼消息集散地）。用工具完成。",
		repeats: 3,
	},
	configure: (b) =>
		b
			.toolArgs(
				"NovelWrite",
				jsonSubset({
					kind: "location",
					values: [{ name: "青云客栈" }, { name: "落雁渡口" }, { name: "听雨楼" }],
				}),
			)
			.anyToolError({ max: 0 })
			.store((s) => listOf(s.locations).length >= 3),
};
