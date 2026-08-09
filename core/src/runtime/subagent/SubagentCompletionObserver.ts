/**
 * 读路径惰性终结：探测子会话 Run 终态并驱动完成桥交付结果。
 * Lazily finalizes a subagent binding on read by probing the child Run
 * terminal state and driving the completion bridge.
 */
import { noopLogger, type Logger } from "../../observability/index.js";
import type { SubagentBindingStore } from "./SubagentBindingStore.js";
import type { SubagentCompletionBridge } from "./SubagentCompletionBridge.js";
import {
  SUBAGENT_STATUS,
  type SubagentBinding,
  type SubagentStatus,
} from "./SubagentProtocol.js";

/** 子会话 Run 终态（不含 subagentId，由 observer 补全）。Terminal child Run state. */
export interface SubagentChildRunTerminal {
  readonly status: "completed" | "failed" | "cancelled";
  readonly completedAt: string;
  readonly errorCode?: string;
  readonly cancellationReason?: string;
}

/** 子会话 Run 终态读取端口；由窄 RPC 客户端适配实现。Child Run terminal reader port. */
export interface SubagentChildRunTerminalReader {
  readChildRunTerminal(
    conversationId: string,
  ): Promise<SubagentChildRunTerminal | undefined>;
}

export interface SubagentCompletionObserverOptions {
  readonly bindings: SubagentBindingStore;
  readonly bridge: SubagentCompletionBridge;
  readonly childRunTerminal: SubagentChildRunTerminalReader;
  readonly logger?: Logger;
  /** 墙钟毫秒（日志限频用）；默认 Date.now。Wall-clock ms for log throttling. */
  readonly now?: () => number;
}

/** observe_failed 限频：同 binding 在此窗口内最多打一条，防 GUI 高频轮询洪泛日志。
 * observe_failed throttle: at most one log per binding per window. */
const OBSERVE_FAILED_COOLDOWN_MS = 5_000;

/**
 * 观察子会话 Run 终态并在读路径上惰性终结 binding：仅当 binding 非终态时探测；
 * 发现终态即 `bridge.reconcile` → `deliverResult` → `recordTerminalStatus`，
 * 使后续 TaskOutput 轮询立即看到终态与结果。所有失败仅记录，绝不抛出。
 * Observes the child Run terminal and lazily finalizes a non-terminal binding on
 * read; reconcile failures are logged and swallowed so the query path never
 * throws.
 */
export class SubagentCompletionObserver {
  readonly #bindings: SubagentBindingStore;
  readonly #bridge: SubagentCompletionBridge;
  readonly #childRunTerminal: SubagentChildRunTerminalReader;
  readonly #now: () => number;
  readonly #lastFailureAt = new Map<string, number>();
  readonly #logger: Logger;

  constructor(options: SubagentCompletionObserverOptions) {
    this.#bindings = options.bindings;
    this.#bridge = options.bridge;
    this.#childRunTerminal = options.childRunTerminal;
    this.#now = options.now ?? (() => Date.now());
    this.#logger = (options.logger ?? noopLogger).child({
      component: "subagent_completion_observer",
    });
  }

  async check(binding: SubagentBinding): Promise<void> {
    if (isTerminal(binding.status)) return;
    try {
      const terminal = await this.#childRunTerminal.readChildRunTerminal(
        binding.childConversationId,
      );
      if (terminal === undefined) return;
      // 细节字段（errorCode/cancellationReason）不在此透传：run-state 原因不满足子代理
      // 协议枚举格式，由 bridge 兜底（SUBAGENT_RUN_FAILED / explicit）并经
      // captureSubagentResult 校验。Detail fields are left to bridge defaults.
      await this.#bridge.reconcile({
        subagentId: binding.subagentId,
        status: terminal.status,
        completedAt: terminal.completedAt,
      });
    } catch (error) {
      // reconcile 照常随下次读路径重试（自愈不变），仅限日志频率，避免 1Hz 轮询
      // 在持久失败时刷屏。Reconcile still retries on the next read; only the log
      // volume is throttled so a persistent failure cannot flood the child log.
      const now = this.#now();
      const last = this.#lastFailureAt.get(binding.subagentId) ?? 0;
      if (now - last >= OBSERVE_FAILED_COOLDOWN_MS) {
        this.#lastFailureAt.set(binding.subagentId, now);
        this.#logger.info("runtime.subagent.completion.observe_failed", {
          taskId: binding.subagentId,
          childConversationId: binding.childConversationId,
        });
      }
    }
  }
}

const TERMINAL_BINDING_STATUSES: ReadonlySet<SubagentStatus> = new Set([
  SUBAGENT_STATUS.completed,
  SUBAGENT_STATUS.failed,
  SUBAGENT_STATUS.cancelled,
  SUBAGENT_STATUS.orphaned,
]);

function isTerminal(status: SubagentStatus): boolean {
  return TERMINAL_BINDING_STATUSES.has(status);
}
