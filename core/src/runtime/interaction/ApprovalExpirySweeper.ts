/**
 * 周期结算已过期审批的清扫器：定时调用 coordinator.expire(now)，
 * 避免挂起审批(超过 expiresAt)永久占用内存/阻塞 run 等待。配合跨进程
 * 结算(runtime-orphaned-approval-settlement)，构成审批生命周期完整闭环。
 *
 * Periodically settles expired pending approvals so an unanswered approval
 * (past its expiresAt) cannot block the run or leak memory forever. Together
 * with the cross-instance orphan settlement this closes the approval lifecycle.
 */
import { noopLogger, type Logger } from "../../observability/index.js";
import type { InteractionCoordinator } from "./ToolApprovalInteractionProtocol.js";

export const DEFAULT_APPROVAL_EXPIRY_SWEEP_INTERVAL_MS = 30_000;

export interface ApprovalExpirySweeperOptions {
  readonly coordinator: Pick<InteractionCoordinator, "expire">;
  readonly clock?: { now(): string };
  readonly intervalMs?: number;
  readonly logger?: Logger;
}

export class ApprovalExpirySweeper {
  readonly #coordinator: Pick<InteractionCoordinator, "expire">;
  readonly #clock: { now(): string };
  readonly #intervalMs: number;
  readonly #logger: Logger;
  #timer?: ReturnType<typeof setInterval>;

  constructor(options: ApprovalExpirySweeperOptions) {
    this.#coordinator = options.coordinator;
    this.#clock = options.clock ?? { now: () => new Date().toISOString() };
    this.#intervalMs = captureInterval(
      options.intervalMs ?? DEFAULT_APPROVAL_EXPIRY_SWEEP_INTERVAL_MS,
    );
    this.#logger = (options.logger ?? noopLogger).child({
      component: "approval_expiry_sweeper",
    });
  }

  start(): void {
    if (this.#timer !== undefined) return;
    this.#timer = setInterval(() => {
      this.sweep().catch((error) => {
        this.#logger.warn("approval_expiry.sweep_failed", {
          errorName: captureStableFailure(error),
        });
      });
    }, this.#intervalMs);
  }

  /** 立即执行一次过期清扫（含定时触发共用）。 */
  async sweep(): Promise<void> {
    const expired = await this.#coordinator.expire(this.#clock.now());
    if (expired.length > 0) {
      this.#logger.info("approval_expiry.sweep_completed", {
        expiredCount: expired.length,
      });
    }
  }

  stop(): void {
    if (this.#timer === undefined) return;
    clearInterval(this.#timer);
    this.#timer = undefined;
  }
}

function captureInterval(intervalMs: number): number {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000) {
    throw new TypeError("Approval expiry sweep interval must be at least 1000ms");
  }
  return intervalMs;
}

function captureStableFailure(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
    return error.name;
  }
  return "unknown";
}
