/**
 * compose_mode nudge（ContextNudgePolicy 实现，main agent 专属）。
 *
 * 触发单位是 provider call。状态由 ComposeModeStateProvider 快照驱动，按「落点状态」
 * 附加对应提醒（状态键 = active ? phase : "inactive"，仅状态键变化时发一条对应当前
 * 状态的提醒，多次切换间隔只认最终落点）：
 * - 落点 designing（进入/重进）：持久化 compose_mode（full 5-phase 工作流）；若
 *   hasPriorDraft 则再附加持久化 compose_mode_reentry（已有旧草稿 → 继续/覆盖决策）。
 * - 落点 pending（ExitComposeMode 提交）：持久化 compose_mode_pending。
 * - 落点 inactive（批准/放弃退出）：持久化 compose_mode_exit（显式退出信号）。
 * - 稳态（状态键不变）且仍 compose：每 sparseEveryCalls 次 provider call 附加一次
 *   瞬态 compose_mode_sparse（transient 改 ProviderCall，不进 turn/不落盘）；
 *   同 turn 至多一次（curTurn 守卫，新 run curTurn 归零自然放行）。
 *
 * 构造时以当前快照 seed latch：hydrate 后重启不把「已在 compose」误判为上升沿重发
 * compose_mode（入口顺序保证：hydrate → buildNovelAgent → 策略构造）。
 */
import type { LoopContext } from "../../loop/LoopContext.js";
import type { RunContext } from "../../loop/types.js";
import type { ProviderCall, LLMessage } from "../../provider/types.js";
import type { ContextNudgePolicy } from "../ContextNudgePolicy.js";
import type { ComposeModeStateProvider, ComposeModePhase } from "../../../conversation/compose/ComposeModeState.js";
import {
	designFileWorkspaceRelativePath,
	renderComposeModeFullText,
	renderComposeModeExitText,
	renderComposeModePendingText,
	renderComposeModeReentryText,
	renderComposeModeSparseText,
} from "../../../conversation/compose/composeText.js";

/** sparse 刷新节奏缺省值（可经构造参数配置） */
export const COMPOSE_MODE_SPARSE_EVERY_CALLS_DEFAULT = 5;

/** ComposeModeNudgePolicy 构造选项 */
export interface ComposeModeNudgePolicyOptions {
	/** 稳态下每多少次 provider call 附加一次 sparse 刷新（缺省 5） */
	readonly sparseEveryCalls?: number;
}

/** 状态键（落点状态）：active 时取 phase，否则 inactive */
type ComposeStateKey = ComposeModePhase | "inactive";

/** latch：上次观察到的落点状态 + sparse 节奏计数 */
interface ComposeLatch {
	readonly lastKey: ComposeStateKey;
	/** 距上一次 attach 的 provider call 数（sparse 刷新节奏） */
	readonly callsSinceReminder: number;
	/** 已发 sparse 的 curTurn（同 turn 至多一次守卫） */
	readonly lastSparseCurTurn?: number;
}

/**
 * compose 模式 transition 提示策略（main agent 专属）。
 * 单策略类内部分发 5 种提醒；文案与 Enter/ExitComposeMode 工具结果共用 composeText。
 */
export class ComposeModeNudgePolicy implements ContextNudgePolicy {
	/** compose 状态提供者 */
	private readonly composeState: ComposeModeStateProvider;
	/** 会话 id（main agent） */
	private readonly conversationId: string;
	/** sparse 刷新节奏（provider call 次数） */
	private readonly sparseEveryCalls: number;
	/** latch：构造时以当前快照 seed（重启不误发上升沿） */
	private latch: ComposeLatch;

	/**
	 * 构造 ComposeModeNudgePolicy（latch 以当前快照 seed）
	 * @param composeState compose 状态提供者
	 * @param conversationId 会话 id
	 * @param options sparse 频率配置（缺省 5）
	 */
	constructor(
		composeState: ComposeModeStateProvider,
		conversationId: string,
		options: ComposeModeNudgePolicyOptions = {},
	) {
		this.composeState = composeState;
		this.conversationId = conversationId;
		this.sparseEveryCalls = options.sparseEveryCalls ?? COMPOSE_MODE_SPARSE_EVERY_CALLS_DEFAULT;
		const snap = composeState.snapshot(conversationId);
		this.latch = Object.freeze({
			lastKey: stateKeyOf(snap.active, snap.phase),
			callsSinceReminder: 0,
		});
	}

	/**
	 * 持久提示注入：状态键变化时按落点状态追加 system reminder（appendTurnMessages → 落盘）
	 * @param loop LoopContext
	 * @param _run 当前 run 运行状态
	 * @returns 是否注入了
	 */
	persistentNudgeIfNeeded(loop: LoopContext, _run: RunContext): boolean {
		const snap = this.composeState.snapshot(this.conversationId);
		const key = stateKeyOf(snap.active, snap.phase);
		if (key === this.latch.lastKey) {
			return false;
		}
		let injected = false;
		if (snap.active && snap.phase === "designing") {
			// 落点 designing（进入/重进）→ full compose_mode；有旧草稿再附 reentry
			loop.appendTurnMessages([
				{
					role: "system",
					content: renderComposeModeFullText(
						snap.designFilePath === undefined
							? undefined
							: designFileWorkspaceRelativePath(snap.designFilePath),
					),
				},
			]);
			injected = true;
			if (snap.hasPriorDraft === true) {
				loop.appendTurnMessages([{ role: "system", content: renderComposeModeReentryText() }]);
			}
		} else if (snap.active && snap.phase === "pending") {
			// 落点 pending（提交审批）→ compose_mode_pending
			loop.appendTurnMessages([{ role: "system", content: renderComposeModePendingText() }]);
			injected = true;
		} else {
			// 落点 inactive（批准/放弃退出）→ compose_mode_exit
			loop.appendTurnMessages([{ role: "system", content: renderComposeModeExitText() }]);
			injected = true;
		}
		this.latch = Object.freeze({ lastKey: key, callsSinceReminder: 0 });
		return injected;
	}

	/**
	 * 瞬时注入：稳态仍 compose 时每 sparseEveryCalls 次 provider call 向 ProviderCall
	 * 尾插 sparse 刷新 system 消息（不持久化）；同 turn 至多一次
	 * @param _loop LoopContext
	 * @param run 当前 run 运行状态（curTurn 守卫）
	 * @param call ProviderCall（原地修改：messages 尾插 system）
	 * @returns 是否注入了
	 */
	transientNudgeIfNeeded(_loop: LoopContext, run: RunContext, call: ProviderCall): boolean {
		const snap = this.composeState.snapshot(this.conversationId);
		if (!snap.active) {
			return false;
		}
		const key = stateKeyOf(snap.active, snap.phase);
		if (key !== this.latch.lastKey) {
			// 状态键刚变化（本 call 的 persistent 已处理）：只推进 latch，不发 sparse
			this.latch = Object.freeze({ lastKey: key, callsSinceReminder: 0 });
			return false;
		}
		const callsSinceReminder = this.latch.callsSinceReminder + 1;
		if (
			callsSinceReminder >= this.sparseEveryCalls &&
			this.latch.lastSparseCurTurn !== run.curTurn
		) {
			insertSystemReminder(call, renderComposeModeSparseText());
			this.latch = Object.freeze({
				lastKey: key,
				callsSinceReminder: 0,
				lastSparseCurTurn: run.curTurn,
			});
			return true;
		}
		this.latch = Object.freeze({
			lastKey: key,
			callsSinceReminder,
			...(this.latch.lastSparseCurTurn === undefined ? {} : { lastSparseCurTurn: this.latch.lastSparseCurTurn }),
		});
		return false;
	}
}

/** 快照 → 状态键（active ? phase : "inactive"） */
function stateKeyOf(active: boolean, phase: ComposeModePhase): ComposeStateKey {
	return active ? phase : "inactive";
}

/** 向 ProviderCall.messages 尾部插入一条 system 提醒（原地修改，不持久化） */
function insertSystemReminder(call: ProviderCall, content: string): void {
	const message: LLMessage = { role: "system", content };
	call.messages.push(message);
}
