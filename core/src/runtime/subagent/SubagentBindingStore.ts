/** Durable projection boundary and change feed for Subagent bindings. */
import type { SubagentBinding } from "./SubagentProtocol.js";

export interface SubagentBindingQuery {
  readonly parentConversationId?: string;
  readonly parentRunId?: string;
  readonly activeOnly?: boolean;
}

export interface SubagentBindingChange {
  readonly sequence: number;
  readonly binding: SubagentBinding;
}

export interface SubagentBindingSubscription extends AsyncIterable<SubagentBindingChange> {
  close(): Promise<void>;
}

export interface SubagentBindingStore {
  put(binding: SubagentBinding): Promise<void>;
  get(subagentId: string): Promise<SubagentBinding | undefined>;
  list(query?: SubagentBindingQuery): Promise<readonly SubagentBinding[]>;
  subscribe(afterSequence?: number): SubagentBindingSubscription;
}
