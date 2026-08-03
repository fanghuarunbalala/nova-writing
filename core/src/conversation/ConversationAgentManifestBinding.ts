/** Validates the Manifest identity required to resume a bound Agent Conversation. */
import type { AgentBindingIdentity } from "../storage/conversation/ConversationAgentBinding.js";

export interface ConversationAgentManifestBinding
  extends AgentBindingIdentity {
  readonly manifestId: string;
  readonly manifestDigest: string;
}

export function captureConversationAgentManifestBinding(
  value: AgentBindingIdentity,
): ConversationAgentManifestBinding | undefined {
  if (value.manifestId === undefined && value.manifestDigest === undefined) {
    return undefined;
  }
  if (
    typeof value.manifestId !== "string" ||
    value.manifestId.trim().length === 0 ||
    typeof value.manifestDigest !== "string" ||
    value.manifestDigest.trim().length === 0
  ) {
    throw new TypeError("Conversation Agent Manifest binding is incomplete");
  }
  return Object.freeze({
    agentType: requireNonBlank(value.agentType, "Agent type"),
    definitionVersion: requireNonBlank(
      value.definitionVersion,
      "Agent definition version",
    ),
    manifestId: value.manifestId,
    manifestDigest: value.manifestDigest,
  });
}

function requireNonBlank(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
