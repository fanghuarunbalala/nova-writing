/** Production Node SHA-256 PromptDigester used to freeze compiled Prompt identities. */
import { createHash } from "node:crypto";
import {
  capturePromptDigest,
  type PromptDigest,
  type PromptDigester,
} from "../../prompt/index.js";

export class NodeSha256PromptDigester implements PromptDigester {
  readonly algorithm = "sha256" as const;

  async digest(content: string): Promise<PromptDigest> {
    return digestPromptText(content);
  }
}

export function digestPromptText(value: string): PromptDigest {
  return capturePromptDigest(
    `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`,
  );
}
