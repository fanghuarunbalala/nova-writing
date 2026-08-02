/** Node SHA-256 adapter for canonical complete Novel Operation envelopes. */
import { createHash } from "node:crypto";
import {
  canonicalizeNovelOperation,
  captureNovelOperationDigest,
  type NovelOperation,
  type NovelOperationDigest,
  type NovelOperationDigester,
} from "../../../novel/index.js";

export class NodeSha256NovelOperationDigester
  implements NovelOperationDigester
{
  readonly algorithm = "sha256" as const;

  async digest(operation: NovelOperation): Promise<NovelOperationDigest> {
    return digestNovelSha256Text(canonicalizeNovelOperation(operation));
  }
}

export function digestNovelSha256Text(
  canonicalText: string,
): NovelOperationDigest {
  const hex = createHash("sha256")
    .update(canonicalText, "utf8")
    .digest("hex");
  return captureNovelOperationDigest(`sha256:${hex}`);
}
