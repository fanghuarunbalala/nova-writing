/** Compile-only proof for the default Novel Agent binding catalog wiring. */
import type { AgentManifestProvisioner } from "../src/agent/index.js";
import {
  DefaultNovelAgentBindingConversationCatalog,
  DefaultNovelConversationManifestProvisioner,
} from "../src/node/index.js";

const provisioner: AgentManifestProvisioner =
  new DefaultNovelConversationManifestProvisioner();
void provisioner;
void DefaultNovelAgentBindingConversationCatalog;
