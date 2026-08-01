/** Node SHA-256 adapter for deterministic Runtime OutputEvent identities. */
import { createHash } from "node:crypto";
import type { RuntimeEventIdHasher } from "../../runtime/execution/event/RuntimeEventIdFactory.js";

export class NodeSha256RuntimeEventIdHasher implements RuntimeEventIdHasher {
  readonly algorithm = "sha256" as const;

  digest(canonicalIdentity: string): string {
    return createHash("sha256").update(canonicalIdentity, "utf8").digest("hex");
  }
}
