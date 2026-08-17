/**
 * case 15 负向（compose 模式禁写）：EnterComposeMode 后 canonical 写
 * （NovelWrite/Edit/Delete）被权限门拒绝——store 零落库，且被拒调用以
 * result 文本「已拒绝（设计模式激活…）」回填（非 error）。
 */
import type { CaseSpec } from "../src/compile.js";
import { listOf } from "../src/snapshot-view.js";

export const spec: CaseSpec = {
	name: "compose-no-canonical-write",
	input: {
		task: "进入设计模式（compose mode），然后把以下角色设定落档：林默，剑客。用工具完成。",
		repeats: 3,
	},
	configure: (b) =>
		b
			.toolHasCalled("EnterComposeMode")
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
