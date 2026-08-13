/**
 * todo_idle nudge（从旧 main 分支迁移）。
 * 连续 ≥3 轮未调用 TodoWrite → 每 run 注入一次持久 system reminder。
 */
import type { LoopContext } from "../../loop/LoopContext.js";
import type { RunContext } from "../../loop/types.js";
import type { ContextNudgePolicy } from "../ContextNudgePolicy.js";

/** 连续多少轮未调用 TodoWrite 后才提醒 */
const TODO_IDLE_SUSTAINED_CALLS = 3;

/** reminder 标记（稳定断言用） */
export const TODO_IDLE_MARK = "待办列表维护提醒";

const TODO_IDLE_TEXT = [
  `# ${TODO_IDLE_MARK}`,
  "已有多轮未调用 TodoWrite 维护任务列表，请检查当前待办是否仍有效：",
  "- 用 TodoWrite 更新列表（新增 / 标记完成 / 取消），保持任务与当前工作一致。",
].join("\n");

/** todo_idle 提示策略：TodoWrite 久未调用时注入 reminder */
export class TodoIdleNudgePolicy implements ContextNudgePolicy {
	/** 上次提醒的 run（每 run 至多一次） */
	private lastNudgedRun = -1;

	/** 持久提示注入：连续 ≥3 轮未调用 TodoWrite 时追加 reminder */
	persistentNudgeIfNeeded(loop: LoopContext, run: RunContext): boolean {
		const lastTodoWrite = run.toolsLastTurn.get("TodoWrite");
		const idleCalls = lastTodoWrite === undefined ? run.curTurn : run.curTurn - lastTodoWrite;
		if (idleCalls >= TODO_IDLE_SUSTAINED_CALLS && run.curTurn !== this.lastNudgedRun) {
			this.lastNudgedRun = run.curTurn;
			loop.appendTurnMessages([{ role: "system", content: TODO_IDLE_TEXT }]);
			return true;
		}
		return false;
	}

	/** 瞬时注入：不适用 */
	transientNudgeIfNeeded(): boolean {
		return false;
	}
}
