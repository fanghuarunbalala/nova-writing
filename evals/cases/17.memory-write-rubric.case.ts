/**
 * case 17 记忆写入质量（PRD memory-两层记忆 §6.2）：作者显式要求记住偏好 →
 * 预期一次 MemoryWrite：kebab-case 主题名、type=feedback、description 一句话、
 * content 三段式（Why 含理由）。LLM 裁判 rubric + 落盘断言双保险。threshold 2/3。
 */
import type { CaseSpec } from "../src/compile.js";
import { toolArgsJudge } from "../src/assertions.js";

export const spec: CaseSpec = {
	name: "memory-write-rubric",
	input: {
		task: "记住：以后所有打斗场面都用短句写，长句拖节奏。帮我存进跨会话记忆。",
		repeats: 3,
	},
	configure: (b) =>
		b
			.toolHasCalled("MemoryWrite")
			.custom(
				toolArgsJudge(
					"MemoryWrite",
					[
						"name 是 kebab-case 主题名（如 battle-style），不是句子；",
						"type 是四类之一且 feedback 最合理；",
						"description 是一句话（≤120 字）；",
						"content 为三段式（## 规则/事实 → ## Why → ## How to apply），且 How to apply 给出可执行口径（如句长上限）。",
					].join("\n"),
					{ scoreAtLeast: 3 },
				),
			)
			.file("memory/MEMORY.md", "（feedback）")
			.threshold(2 / 3),
};
