/** Compile-time examples for durable Conversation-to-Manifest bindings. */
import {
  captureConversationAgentManifestBinding,
  type AgentBindingIdentity,
  type ConversationAgentManifestBinding,
} from "../src/index.js";

const identity: AgentBindingIdentity = {
  agentType: "novel_agent",
  definitionVersion: "1.0.0",
  manifestId: "manifest:novel-agent",
  manifestDigest: `sha256:${"0".repeat(64)}`,
};
const binding: ConversationAgentManifestBinding =
  captureConversationAgentManifestBinding(identity)!;

// @ts-expect-error Resolved Manifest bindings require a Manifest ID.
const incomplete: ConversationAgentManifestBinding = {
  agentType: "novel_agent",
  definitionVersion: "1.0.0",
  manifestDigest: `sha256:${"0".repeat(64)}`,
};

void binding;
void incomplete;
