/** Provider-neutral Ports and immutable values used to provision child Conversations. */
import type { InputReceipt } from "../../event/input/InputReceipt.js";
import type { SubagentBinding, SubagentRequest } from "./SubagentProtocol.js";

export const SUBAGENT_TOOL_POLICY_RELATION = Object.freeze({
  same: "same",
  reduced: "reduced",
  expanded: "expanded",
  unknown: "unknown",
} as const);

export type SubagentToolPolicyRelation =
  (typeof SUBAGENT_TOOL_POLICY_RELATION)[keyof typeof SUBAGENT_TOOL_POLICY_RELATION];

export interface SubagentParentScope {
  readonly parentConversationId: string;
  readonly parentRunId: string;
  readonly workspaceId: string;
  readonly depth: 0 | 1;
  readonly toolPolicyId: string;
}

export interface SubagentParentScopeReader {
  readParentScope(request: SubagentRequest): Promise<SubagentParentScope>;
}

export interface SubagentToolPolicyRelationReader {
  readRelation(
    parentToolPolicyId: string,
    childToolPolicyId: string,
  ): Promise<SubagentToolPolicyRelation>;
}

export interface ChildConversationCreateInput {
  readonly subagentId: string;
  readonly workspaceId: string;
  readonly parentConversationId: string;
  readonly parentRunId: string;
  readonly agentType: string;
  readonly definitionVersion: string;
  readonly toolPolicyId: string;
  readonly requestedAt: string;
}

export interface ChildConversationCreation {
  readonly childConversationId: string;
  readonly createdAt: string;
}

export interface ChildConversationCreationPort {
  createChild(input: ChildConversationCreateInput): Promise<ChildConversationCreation>;
}

export interface ChildConversationActivationPort {
  activateChild(binding: SubagentBinding): Promise<void>;
}

export interface ChildConversationTaskAssignmentPort {
  assignTask(
    binding: SubagentBinding,
    request: SubagentRequest,
  ): Promise<InputReceipt>;
}

export interface ChildConversationBindingPersistencePort {
  persist(binding: SubagentBinding): Promise<void>;
}

export interface ChildConversationRollbackPort {
  rollbackChild(binding: SubagentBinding): Promise<void>;
}

export interface ChildConversationManagerClock {
  now(): string;
}

export interface ChildConversationCapacitySnapshot {
  readonly activeGlobal: number;
  readonly activeForParentRun: number;
}

export interface ChildConversationManager {
  spawn(request: SubagentRequest): Promise<SubagentBinding>;

  recordTerminalStatus(
    subagentId: string,
    status: "completed" | "failed" | "cancelled" | "orphaned",
    updatedAt?: string,
  ): Promise<SubagentBinding>;

  getBinding(subagentId: string): SubagentBinding | undefined;

  listBindings(): readonly SubagentBinding[];

  getCapacity(
    parentConversationId: string,
    parentRunId: string,
  ): ChildConversationCapacitySnapshot;
}
