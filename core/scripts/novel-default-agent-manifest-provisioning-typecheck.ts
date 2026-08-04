/** Compile-only proof for the default Novel Conversation Manifest provisioner. */
import type { AgentManifestProvisioner } from "../src/agent/index.js";
import {
  DEFAULT_NOVEL_AGENT_MANIFEST_ID,
  DefaultNovelConversationManifestProvisioner,
  isDefaultNovelConversationAgent,
} from "../src/node/index.js";

const provisioner: AgentManifestProvisioner =
  new DefaultNovelConversationManifestProvisioner();
void provisioner;
void DEFAULT_NOVEL_AGENT_MANIFEST_ID;
void isDefaultNovelConversationAgent("novel_agent", "1.0.0");
