/**
 * 会话级 Compose 模式状态：阶段 + active + design 文件路径 + preComposeMode 扩展位。
 * Session-scoped Compose mode state: phase, active flag, design file path, and the
 * preComposeMode extension slot.
 *
 * 权限语义 / Permission semantics：`active=true` 时 ComposeAware 策略拒绝 canonical
 * 写入并限定文件工具作用域；批准后 `active=false`（恢复进入前的权限模式）。
 */
import { noopLogger, type Logger } from "../../observability/index.js";

export type ComposeModePhase =
  | "idle"
  | "designing"
  | "pending"
  | "applied"
  | "discarded";

export interface ComposeModeSnapshot {
  readonly phase: ComposeModePhase;
  /** compose 权限模式是否激活（激活期间 canonical 写被拒）。Whether compose permission mode is active. */
  readonly active: boolean;
  /** 当前会话 design 文件绝对路径。Absolute path of the conversation design file. */
  readonly designFilePath?: string;
  /** 进入 compose 前的权限模式（harness 尚无权限模式概念，作为扩展位）。 */
  /** Permission mode before entering compose (extension slot; harness has no mode concept yet). */
  readonly preComposeMode?: string;
}

export const IDLE_COMPOSE_MODE_SNAPSHOT: ComposeModeSnapshot = Object.freeze({
  phase: "idle",
  active: false,
});

export class ComposeStateError extends Error {
  override readonly name = "ComposeStateError";
  readonly code = "NOVEL_COMPOSE_STATE_INVALID";

  constructor(
    readonly phase: ComposeModePhase,
    readonly operation: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ComposeModeStateProviderOptions {
  readonly logger?: Logger;
}

/** 按会话维护 compose 状态的纯内存 provider（无持久化，事件由调用方发射）。 */
/** In-memory per-conversation compose state provider (no persistence; events are emitted by callers). */
export class ComposeModeStateProvider {
  readonly #states = new Map<string, ComposeModeSnapshot>();
  readonly #logger: Logger;

  constructor(options: ComposeModeStateProviderOptions = {}) {
    this.#logger = (options.logger ?? noopLogger).child({
      component: "compose_mode_state",
    });
  }

  snapshot(conversationId: string): ComposeModeSnapshot {
    return this.#states.get(conversationId) ?? IDLE_COMPOSE_MODE_SNAPSHOT;
  }

  /** 进入 compose：idle/discarded/applied -> designing。Enters compose from an inactive phase. */
  enter(
    conversationId: string,
    options: { readonly designFilePath: string; readonly preComposeMode?: string },
  ): ComposeModeSnapshot {
    const current = this.snapshot(conversationId);
    if (current.active) {
      throw this.#invalid(current.phase, "enter", "compose is already active");
    }
    const next = Object.freeze({
      phase: "designing" as const,
      active: true,
      designFilePath: options.designFilePath,
      ...(options.preComposeMode === undefined
        ? {}
        : { preComposeMode: options.preComposeMode }),
    });
    this.#states.set(conversationId, next);
    this.#logger.debug("compose.entered", { conversationId, phase: next.phase });
    return next;
  }

  /** 提交审批：designing -> pending。Submits for approval: designing -> pending. */
  submit(conversationId: string): ComposeModeSnapshot {
    const current = this.snapshot(conversationId);
    if (current.phase !== "designing") {
      throw this.#invalid(current.phase, "submit", "submit requires the designing phase");
    }
    const next = Object.freeze({ ...current, phase: "pending" as const });
    this.#states.set(conversationId, next);
    this.#logger.debug("compose.submitted", { conversationId });
    return next;
  }

  /** 批准：designing|pending -> applied，且 active=false（恢复进入前权限模式）。 */
  /** Approves: designing|pending -> applied with active=false (mode restored). */
  approve(conversationId: string): ComposeModeSnapshot {
    const current = this.snapshot(conversationId);
    if (current.phase !== "designing" && current.phase !== "pending") {
      throw this.#invalid(current.phase, "approve", "approve requires designing or pending");
    }
    const next = Object.freeze({
      ...current,
      phase: "applied" as const,
      active: false,
    });
    this.#states.set(conversationId, next);
    this.#logger.debug("compose.approved", { conversationId });
    return next;
  }

  /** 拒绝：pending -> designing（active 保持 true）。Rejects: pending -> designing. */
  reject(conversationId: string): ComposeModeSnapshot {
    const current = this.snapshot(conversationId);
    if (current.phase !== "pending") {
      throw this.#invalid(current.phase, "reject", "reject requires the pending phase");
    }
    const next = Object.freeze({ ...current, phase: "designing" as const });
    this.#states.set(conversationId, next);
    this.#logger.debug("compose.rejected", { conversationId });
    return next;
  }

  /** 放弃：designing|pending -> discarded，active=false。Discards an active design session. */
  discard(conversationId: string): ComposeModeSnapshot {
    const current = this.snapshot(conversationId);
    if (current.phase !== "designing" && current.phase !== "pending") {
      throw this.#invalid(current.phase, "discard", "discard requires designing or pending");
    }
    const next = Object.freeze({
      ...current,
      phase: "discarded" as const,
      active: false,
    });
    this.#states.set(conversationId, next);
    this.#logger.debug("compose.discarded", { conversationId });
    return next;
  }

  /** 清空会话状态（会话结束时）。Clears state for a conversation. */
  clear(conversationId: string): void {
    this.#states.delete(conversationId);
    this.#logger.debug("compose.cleared", { conversationId });
  }

  #invalid(
    phase: ComposeModePhase,
    operation: string,
    message: string,
  ): ComposeStateError {
    return new ComposeStateError(phase, operation, message);
  }
}
