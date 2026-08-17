/**
 * case 9 失败自愈（duplicate id）：seed 占用 char_linmo，任务要求同 id 建新角色。
 * 双通道：模型冒进直接写 → 撞 TOOL_PRECHECK_FAILED（id 占用）→ 换 id 重试成功；
 * 模型守规矩先读发现占用 → 避让后写入成功。两条路都算过（强迫用已占用 id 与
 * "自愈=换 id"自相矛盾，coercive 不可行）。不变量：林小默落库且 char_linmo
 * 仍是林默（不得覆盖既有实体）。
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
			.toolResponse("NovelWrite", jsonSubset({ items: [{ status: "applied" }] }))
			.store((s) => {
				const chars = listOf<{ id: string; name?: string }>(s.characters);
				return (
					chars.some((c) => c.name === "林小默") &&
					chars.find((c) => c.id === "char_linmo")?.name === "林默"
				);
			})
			.custom((m) => {
				const fails = m.toolErrors.filter((e) => e.code === "TOOL_PRECHECK_FAILED").length;
				if (fails >= 1 && fails <= 2) return true;
				const firstWrite = m.toolCalls.findIndex((c) => c.name === "NovelWrite");
				return (
					firstWrite >= 0 &&
					m.toolCalls.slice(0, firstWrite).some((c) => c.name === "NovelRead")
				);
			})
			.threshold(2 / 3),
};
