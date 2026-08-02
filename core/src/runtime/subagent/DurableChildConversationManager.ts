/** Persists Manager binding transitions without changing provisioning semantics. */
import type { ChildConversationCapacitySnapshot, ChildConversationManager } from "./ChildConversationManagerProtocol.js";
import type { SubagentBindingStore } from "./SubagentBindingStore.js";
import type { SubagentBinding, SubagentRequest, SubagentTerminalStatus } from "./SubagentProtocol.js";

export class DurableChildConversationManager implements ChildConversationManager {
  constructor(private readonly delegate: ChildConversationManager, private readonly store: SubagentBindingStore) {}
  async spawn(request: SubagentRequest): Promise<SubagentBinding> { const binding = await this.delegate.spawn(request); await this.store.put(binding); return binding; }
  async recordTerminalStatus(subagentId: string, status: SubagentTerminalStatus, updatedAt?: string): Promise<SubagentBinding> { const binding = await this.delegate.recordTerminalStatus(subagentId, status, updatedAt); await this.store.put(binding); return binding; }
  getBinding(subagentId: string): SubagentBinding | undefined { return this.delegate.getBinding(subagentId); }
  listBindings(): readonly SubagentBinding[] { return this.delegate.listBindings(); }
  getCapacity(parentConversationId: string, parentRunId: string): ChildConversationCapacitySnapshot { return this.delegate.getCapacity(parentConversationId, parentRunId); }
}
