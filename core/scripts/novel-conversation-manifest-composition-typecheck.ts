/** Compile-only proof for production Novel conversation manifest assembly primitives. */
import type { AgentManifestProvisioner } from "../src/agent/index.js";
import {
  NodeSha256PromptDigester,
  createNovelConversationManifestComposition,
} from "../src/node/index.js";

const composition = createNovelConversationManifestComposition();
void composition;

const digester = new NodeSha256PromptDigester();
void digester.digest("proof");

const provisioner: AgentManifestProvisioner = {
  async provision() {
    return undefined;
  },
};
void provisioner;
