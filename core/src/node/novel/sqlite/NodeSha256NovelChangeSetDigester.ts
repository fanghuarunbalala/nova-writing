/** Node SHA-256 adapter for canonical frozen Novel ChangeSet identities. */
import { createHash } from "node:crypto";
import {
  canonicalizeNovelChangeSetIdentity,
  captureNovelChangeSetDigest,
  type NovelChangeSetDigester,
  type NovelChangeSetIdentity,
  type NovelChangeSetDigest,
} from "../../../novel/index.js";

export class NodeSha256NovelChangeSetDigester
  implements NovelChangeSetDigester
{
  readonly algorithm = "sha256" as const;

  async digest(
    changeSet: NovelChangeSetIdentity,
  ): Promise<NovelChangeSetDigest> {
    const canonical = canonicalizeNovelChangeSetIdentity(changeSet);
    const hex = createHash("sha256").update(canonical, "utf8").digest("hex");
    return captureNovelChangeSetDigest(`sha256:${hex}`);
  }
}
