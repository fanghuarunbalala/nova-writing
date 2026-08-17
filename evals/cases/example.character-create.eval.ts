/**
 * 示例 case：打通 evalite 链路用（非首批 15 case 清单，可删/可改）。
 * 运行：pnpm --filter @novel/evals dev（需 NOVEL_EVAL_API_KEY 或回退 env）。
 */
import { defineCase } from "../src/compile.js";

defineCase(
	"example.character-create",
	{
		task: "为我的小说创建一个角色：主角叫林默，是一名剑客。用工具完成。",
		repeats: 3,
	},
	(b) =>
		b
			.toolHasCalled("NovelCharacterWrite")
			.toolNotCalled("AskUserQuestion")
			.anyToolError({ code: "TOOL_ARGUMENTS_INVALID", max: 0 })
			.turns({ max: 8 })
			.finalReplyContains("林默")
			.store((s) => {
				const characters = s.characters as Array<{ name?: string }>;
				return Array.isArray(characters) && characters.some((c) => c.name === "林默");
			}),
);
