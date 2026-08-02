/** Node SHA-256 adapter for canonical Tool argument approval identities. */
import { createHash } from "node:crypto";
import type {
  ToolArgumentDigest,
  ToolArgumentDigester,
} from "../../tools/execution/ToolExecutionContracts.js";
import { canonicalToolArguments } from "../../tools/execution/ToolExecutionProtocolValidator.js";
import type { JsonValue } from "../../event/protocol/index.js";

export class NodeSha256ToolArgumentDigester implements ToolArgumentDigester {
  async digest(arguments_: JsonValue): Promise<ToolArgumentDigest> {
    const hexadecimal = createHash("sha256")
      .update(canonicalToolArguments(arguments_), "utf8")
      .digest("hex");
    return `sha256:${hexadecimal}`;
  }
}
