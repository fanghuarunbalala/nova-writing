/** Host-level child tree query and binding-change subscription. */
import type { SubagentBindingChange, SubagentBindingStore, SubagentBindingSubscription } from "./SubagentBindingStore.js";
import type { SubagentBinding } from "./SubagentProtocol.js";

export interface ConversationTreeSnapshot { readonly rootConversationId: string; readonly children: readonly SubagentBinding[]; }

export class ConversationTreeObserver {
  constructor(private readonly store: SubagentBindingStore) {}
  async getTree(rootConversationId: string): Promise<ConversationTreeSnapshot> { return Object.freeze({ rootConversationId, children: await this.store.list({ parentConversationId: rootConversationId }) }); }
  subscribe(afterSequence = 0): SubagentBindingSubscription { return this.store.subscribe(afterSequence); }
}

export type ConversationTreeChange = SubagentBindingChange;
