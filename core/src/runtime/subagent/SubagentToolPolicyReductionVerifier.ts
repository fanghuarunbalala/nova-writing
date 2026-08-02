/** Accepts only Tool policies authoritatively classified as equal or reduced. */
import type {
  SubagentToolPolicyRelation,
  SubagentToolPolicyRelationReader,
} from "./ChildConversationManagerProtocol.js";
import { SUBAGENT_TOOL_POLICY_RELATION } from "./ChildConversationManagerProtocol.js";
import {
  CHILD_CONVERSATION_MANAGER_FAILURE,
  ChildConversationManagerError,
} from "./ChildConversationManagerErrors.js";

export class SubagentToolPolicyReductionVerifier {
  constructor(private readonly reader: SubagentToolPolicyRelationReader) {}

  async verify(
    parentToolPolicyId: string,
    childToolPolicyId: string,
    identity: {
      readonly subagentId: string;
      readonly parentConversationId: string;
      readonly parentRunId: string;
    },
  ): Promise<Extract<SubagentToolPolicyRelation, "same" | "reduced">> {
    let relation: SubagentToolPolicyRelation;
    try {
      relation = await this.reader.readRelation(
        parentToolPolicyId,
        childToolPolicyId,
      );
    } catch {
      throw new ChildConversationManagerError(
        CHILD_CONVERSATION_MANAGER_FAILURE.toolPolicyUnavailable,
        identity,
      );
    }

    if (
      relation !== SUBAGENT_TOOL_POLICY_RELATION.same &&
      relation !== SUBAGENT_TOOL_POLICY_RELATION.reduced
    ) {
      throw new ChildConversationManagerError(
        CHILD_CONVERSATION_MANAGER_FAILURE.toolPolicyExpansion,
        identity,
      );
    }
    return relation;
  }
}
