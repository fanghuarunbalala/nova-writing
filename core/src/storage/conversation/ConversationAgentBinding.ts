export type ConversationAgentBindingStatus = "active" | "superseded" | "detached";

export interface AgentBindingIdentity {
  agentType: string;
  definitionVersion: string;
  manifestDigest?: string;
}

export interface ConversationAgentBinding extends AgentBindingIdentity {
  id: string;
  conversationId: string;
  revision: number;
  status: ConversationAgentBindingStatus;
  createdAt: string;
  supersededAt?: string;
}
