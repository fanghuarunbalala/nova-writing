/** Node SHA-256 adapter for the platform-neutral Message projection protocol. */
import { createHash } from "node:crypto";
import type { MessageProjectionHasher } from "../../storage/index.js";

export class NodeSha256MessageProjectionHasher implements MessageProjectionHasher {
  readonly algorithm = "sha256" as const;

  digest(canonicalContent: string): string {
    return createHash("sha256").update(canonicalContent, "utf8").digest("hex");
  }
}
