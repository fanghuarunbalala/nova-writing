/** Node SHA-256 adapter for canonical Novel ChangeSet Approval identities. */
import { createHash } from "node:crypto";
import { canonicalizeNovelChangeSetApprovalContent, captureNovelApprovalDigest, type NovelApprovalDigest, type NovelApprovalDigester, type NovelChangeSetApprovalContent } from "../../../novel/index.js";
export class NodeSha256NovelApprovalDigester implements NovelApprovalDigester {
  readonly algorithm = "sha256" as const;
  async digest(value: NovelChangeSetApprovalContent): Promise<NovelApprovalDigest> {
    return digestNovelApprovalText(canonicalizeNovelChangeSetApprovalContent(value));
  }
}
export function digestNovelApprovalText(value: string): NovelApprovalDigest {
  return captureNovelApprovalDigest(`sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`);
}
