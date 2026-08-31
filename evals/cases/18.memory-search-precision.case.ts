/**
 * case 18 检索精度（PRD memory-两层记忆 §6.3 + BM25/混合检索）：seed 8 条记忆含
 * 干扰项（节奏/人称/禁忌等相近主题），任务要求查询特定条目 → 预期 MemorySearch
 * 被调用且响应含目标条目（precision 首位不强制——rerank/融合的排序质量留给 6.6
 * 长程专项；本 case 锁「查得到 + 调了检索」）。threshold 2/3。
 */
import type { CaseSpec } from "../src/compile.js";
import { memorySeedFiles } from "./memorySeeds.js";
import type { MemoryTopicSeed } from "./memorySeeds.js";

const SEEDS: readonly MemoryTopicSeed[] = [
	{
		name: "battle-style",
		type: "feedback",
		description: "打斗场面要短句为主",
		content: "## 规则/事实\n\n打斗短句≤20字。\n\n## Why\n\n长句拖节奏。\n\n## How to apply\n\n战斗段落自查句长。",
	},
	{ name: "pacing-note", type: "feedback", description: "章节节奏偏好快节奏少铺垫" },
	{ name: "pov-preference", type: "feedback", description: "人称偏好第一人称" },
	{ name: "cliche-taboo", type: "feedback", description: "禁用忽然之类的滥词" },
	{ name: "ending-pref", type: "feedback", description: "结局不要 BE 悲剧收尾" },
	{ name: "update-rhythm", type: "project", description: "每周双更周二周五发 chapters" },
	{ name: "lore-decision", type: "project", description: "主角金手指第14章才解锁" },
	{ name: "research-pointer", type: "reference", description: "参考资料在 research 目录" },
];

export const spec: CaseSpec = {
	name: "memory-search-precision",
	input: {
		task: "查一下跨会话记忆：我对打斗场面的写法有什么要求？",
		repeats: 3,
		seed: { files: memorySeedFiles(SEEDS) },
	},
	configure: (b) =>
		b
			.toolHasCalled("MemorySearch")
			.toolResponse("MemorySearch", "battle-style")
			.finalReplyContains("短句")
			.threshold(2 / 3),
};
