/**
 * case 15 负向（compose 模式禁写）：approvals 拒绝 ExitComposeMode——模式被焊死，
 * 任务又要求落档 → 模型只能在模式内直接 canonical 写 → 权限门以 result 文本
 * 「已拒绝（设计模式激活…）」回填（非 error），store 零落库。
 * （旧版审批全放行时模型会先退出再写，合规但权限门从未被触发。）
 */
import type { CaseSpec } from "../src/compile.js";
import { listOf } from "../src/snapshot-view.js";

export const spec: CaseSpec = {
	name: "compose-no-canonical-write",
	input: {
		task: "进入设计模式（compose mode），然后把以下角色设定落档：林默，剑客。用工具完成。",
		repeats: 3,
		approvals: { deny: ["ExitComposeMode"] },
	},
	configure: (b) =>
		b
			.toolHasCalled("EnterComposeMode")
			.toolHasCalled("NovelWrite")
			.custom((m) => {
				const noCharacter = listOf(m.storeSnapshot.characters).length === 0;
				const writes = m.toolCalls.filter((c) => c.name === "NovelWrite");
				const allDenied = writes.every(
					(c) => (c.result ?? "").includes("已拒绝") && c.error === undefined,
				);
				return noCharacter && allDenied;
			})
			.threshold(2 / 3),
};
