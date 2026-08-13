/**
 * Compose 模式状态机（从旧 main 分支迁移）。
 * 会话级：mode（base mode）+ phase + active + design 文件路径 + preComposeMode。
 * 不变量：compose 会话激活期间 mode === "compose"；approve/discard 后 active=false 且 mode 恢复 preComposeMode。
 */
import { DEFAULT_CONVERSATION_MODE, type ConversationMode } from "../contract/types/index.js";

/** compose 阶段 */
export type ComposeModePhase = "idle" | "designing" | "pending" | "applied" | "discarded";

/** compose 状态快照 */
export interface ComposeModeSnapshot {
	/** 阶段 */
	readonly phase: ComposeModePhase;
	/** compose 权限是否激活（激活期间 canonical 写被拒） */
	readonly active: boolean;
	/** 会话 base mode（compose 激活时为 "compose"） */
	readonly mode: ConversationMode;
	/** 当前会话 design 文件绝对路径 */
	readonly designFilePath?: string;
	/** 进入 compose 前的 base mode（approve/discard 时恢复） */
	readonly preComposeMode?: ConversationMode;
}

/** 空闲快照（默认） */
export const IDLE_COMPOSE_MODE_SNAPSHOT: ComposeModeSnapshot = Object.freeze({
	phase: "idle",
	active: false,
	mode: DEFAULT_CONVERSATION_MODE,
});

/** compose 状态非法转换错误 */
export class ComposeStateError extends Error {
	readonly phase: ComposeModePhase;
	readonly operation: string;

	/**
	 * @param phase 当前阶段
	 * @param operation 触发错误的操作
	 * @param message 说明
	 */
	constructor(phase: ComposeModePhase, operation: string, message: string) {
		super(message);
		this.name = "ComposeStateError";
		this.phase = phase;
		this.operation = operation;
	}
}

/** 按会话维护 compose 状态的纯内存 provider（无持久化；事件由调用方发射） */
export class ComposeModeStateProvider {
	/** conversationId → 快照 */
	private readonly states = new Map<string, ComposeModeSnapshot>();

	/** 当前快照（缺省 idle） */
	snapshot(conversationId: string): ComposeModeSnapshot {
		return this.states.get(conversationId) ?? IDLE_COMPOSE_MODE_SNAPSHOT;
	}

	/** 进入 compose：idle/discarded/applied → designing（active=true，mode=compose） */
	enter(
		conversationId: string,
		options: { readonly designFilePath: string; readonly preComposeMode?: ConversationMode },
	): ComposeModeSnapshot {
		const current = this.snapshot(conversationId);
		if (current.active) {
			throw this.invalid(current.phase, "enter", "compose 已激活");
		}
		const next: ComposeModeSnapshot = Object.freeze({
			phase: "designing",
			active: true,
			mode: "compose",
			designFilePath: options.designFilePath,
			preComposeMode: options.preComposeMode ?? current.mode,
		});
		this.states.set(conversationId, next);
		return next;
	}

	/** 设置 base mode（仅 compose 非激活时） */
	setMode(conversationId: string, mode: ConversationMode): ComposeModeSnapshot {
		const current = this.snapshot(conversationId);
		if (current.active) {
			throw this.invalid(current.phase, "setMode", "setMode 要求 compose 未激活");
		}
		const next: ComposeModeSnapshot = Object.freeze({ phase: "idle", active: false, mode });
		this.states.set(conversationId, next);
		return next;
	}

	/** 提交审批：designing → pending */
	submit(conversationId: string): ComposeModeSnapshot {
		const current = this.snapshot(conversationId);
		if (current.phase !== "designing") {
			throw this.invalid(current.phase, "submit", "submit 要求 designing 阶段");
		}
		const next: ComposeModeSnapshot = Object.freeze({ ...current, phase: "pending" });
		this.states.set(conversationId, next);
		return next;
	}

	/** 批准：designing|pending → applied，active=false，mode 恢复 preComposeMode */
	approve(conversationId: string): ComposeModeSnapshot {
		const current = this.snapshot(conversationId);
		if (current.phase !== "designing" && current.phase !== "pending") {
			throw this.invalid(current.phase, "approve", "approve 要求 designing 或 pending");
		}
		const next: ComposeModeSnapshot = Object.freeze({
			...current,
			phase: "applied",
			active: false,
			mode: current.preComposeMode ?? DEFAULT_CONVERSATION_MODE,
		});
		this.states.set(conversationId, next);
		return next;
	}

	/** 拒绝：pending → designing（active 保持 true） */
	reject(conversationId: string): ComposeModeSnapshot {
		const current = this.snapshot(conversationId);
		if (current.phase !== "pending") {
			throw this.invalid(current.phase, "reject", "reject 要求 pending 阶段");
		}
		const next: ComposeModeSnapshot = Object.freeze({ ...current, phase: "designing" });
		this.states.set(conversationId, next);
		return next;
	}

	/** 放弃：designing|pending → discarded，active=false，mode 恢复 preComposeMode */
	discard(conversationId: string): ComposeModeSnapshot {
		const current = this.snapshot(conversationId);
		if (current.phase !== "designing" && current.phase !== "pending") {
			throw this.invalid(current.phase, "discard", "discard 要求 designing 或 pending");
		}
		const next: ComposeModeSnapshot = Object.freeze({
			...current,
			phase: "discarded",
			active: false,
			mode: current.preComposeMode ?? DEFAULT_CONVERSATION_MODE,
		});
		this.states.set(conversationId, next);
		return next;
	}

	/** 清空会话状态（会话结束） */
	clear(conversationId: string): void {
		this.states.delete(conversationId);
	}

	/** 构造非法转换错误 */
	private invalid(phase: ComposeModePhase, operation: string, message: string): ComposeStateError {
		return new ComposeStateError(phase, operation, message);
	}
}
