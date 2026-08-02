/** Cancels active children for parent terminal states and reclaims orphan bindings. */
import { noopLogger, type Logger } from "../../observability/index.js";
import type { SubagentBindingStore } from "./SubagentBindingStore.js";
import type { SubagentLifecycleCoordinator } from "./SubagentLifecycleCoordinatorProtocol.js";
import { SUBAGENT_CANCELLATION_REASON, type SubagentBinding, type SubagentCancellationReason, type SubagentResult } from "./SubagentProtocol.js";

export type ParentSubagentTermination = "completed" | "failed" | "stopped" | "crashed";
export interface SubagentCancellationPort { cancelChild(binding: SubagentBinding, reason: SubagentCancellationReason): Promise<SubagentResult>; }
export interface SubagentParentRunActivityReader { isParentRunActive(parentConversationId: string, parentRunId: string): Promise<boolean>; }

export class SubagentCancellationCoordinator {
  readonly #logger: Logger;
  constructor(private readonly options: { store: SubagentBindingStore; lifecycle: SubagentLifecycleCoordinator; cancellationPort: SubagentCancellationPort; parentRunActivityReader: SubagentParentRunActivityReader; logger?: Logger }) { this.#logger = (options.logger ?? noopLogger).child({ component: "subagent_cancellation_coordinator" }); }

  async cancelForParent(parentConversationId: string, parentRunId: string, termination: ParentSubagentTermination): Promise<readonly SubagentResult[]> {
    return this.#cancelBindings(await this.options.store.list({ parentConversationId, parentRunId, activeOnly: true }), terminationReason(termination));
  }

  async reclaimOrphans(): Promise<readonly SubagentResult[]> {
    const active = await this.options.store.list({ activeOnly: true });
    const orphaned: SubagentBinding[] = [];
    for (const binding of active) if (!(await this.options.parentRunActivityReader.isParentRunActive(binding.parentConversationId, binding.parentRunId))) orphaned.push(binding);
    return this.#cancelBindings(orphaned, SUBAGENT_CANCELLATION_REASON.orphanReclaimed);
  }

  async #cancelBindings(bindings: readonly SubagentBinding[], reason: SubagentCancellationReason): Promise<readonly SubagentResult[]> {
    const results: SubagentResult[] = [];
    for (const binding of bindings) {
      const result = await this.options.cancellationPort.cancelChild(binding, reason);
      results.push(await this.options.lifecycle.deliverResult(result));
      this.#logger.info("runtime.subagent.child_cancelled", { subagentId: binding.subagentId, parentConversationId: binding.parentConversationId, parentRunId: binding.parentRunId, childConversationId: binding.childConversationId, reason });
    }
    return Object.freeze(results);
  }
}

function terminationReason(termination: ParentSubagentTermination): SubagentCancellationReason {
  switch (termination) {
    case "completed": return SUBAGENT_CANCELLATION_REASON.parentCompleted;
    case "failed": return SUBAGENT_CANCELLATION_REASON.parentFailed;
    case "stopped": return SUBAGENT_CANCELLATION_REASON.parentStopped;
    case "crashed": return SUBAGENT_CANCELLATION_REASON.parentCrashed;
  }
}
