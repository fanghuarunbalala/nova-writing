/**
 * case 9 失败自愈（duplicate id）：seed 占用 char_linmo，任务要求同 id 建新角色 →
 * 预期撞 TOOL_PRECHECK_FAILED（id 占用）→ 模型换 id 重试成功。
 */
import type { CaseSpec } from "../src/compile.js";
import { jsonSubset } from "../src/matcher.js";
import { character } from "./seeds.js";
import { listOf } from "../src/snapshot-view.js";

export const spec: CaseSpec = {
	name: "selfheal-duplicate-id",
	input: {
		task: "创建一个新角色：id 用 char_linmo，名字叫林小默，是林默的少年分身。用工具完成。",
		repeats: 3,
		seed: { novel: [character("char_linmo", "林默")] },
	},
	configure: (b) =>
		b
			.anyToolError({ code: "TOOL_PRECHECK_FAILED", min: 1, max: 2 })
			.toolResponse("NovelWrite", jsonSubset({ items: [{ status: "applied" }] }))
			.store((s) => listOf<{ name?: string }>(s.characters).some((c) => c.name === "林小默"))
			.threshold(2 / 3),
};
