/** Node SHA-256 adapter for immutable Resolution Application Plan identities. */
import { createHash } from "node:crypto";
import {
  canonicalizeNovelResolutionApplicationPlanIdentity,
  captureNovelResolutionApplicationPlanDigest,
  type NovelResolutionApplicationPlanContent,
  type NovelResolutionApplicationPlanDigest,
  type NovelResolutionApplicationPlanDigester,
} from "../../../novel/index.js";

export class NodeSha256NovelResolutionApplicationPlanDigester
  implements NovelResolutionApplicationPlanDigester
{
  readonly algorithm = "sha256" as const;

  async digest(
    plan: NovelResolutionApplicationPlanContent,
  ): Promise<NovelResolutionApplicationPlanDigest> {
    return digestNovelResolutionApplicationPlanText(
      canonicalizeNovelResolutionApplicationPlanIdentity(plan),
    );
  }
}

export function digestNovelResolutionApplicationPlanText(
  canonicalText: string,
): NovelResolutionApplicationPlanDigest {
  const hex = createHash("sha256")
    .update(canonicalText, "utf8")
    .digest("hex");
  return captureNovelResolutionApplicationPlanDigest(`sha256:${hex}`);
}
