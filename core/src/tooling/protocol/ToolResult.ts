/** Provider-neutral final Tool success result with bounded logical artifacts. */
import type { JsonValue } from "../../event/protocol/index.js";
import type { ArtifactReference } from "../../storage/artifact/index.js";

export interface ToolTextContent {
  readonly type: "text";
  readonly text: string;
}

export type ToolResultContent = ToolTextContent;

export interface ToolResult<TDetails extends JsonValue = JsonValue> {
  readonly content: readonly ToolResultContent[];
  readonly details?: TDetails;
  readonly artifacts?: readonly ArtifactReference[];
}

export interface ToolResultLimits {
  readonly maximumContentBlocks: number;
  readonly maximumTextBytes: number;
  readonly maximumDetailsBytes: number;
  readonly maximumArtifactReferences: number;
}

export interface ToolResultCaptureOptions {
  readonly conversationId: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly toolVersion?: string;
  readonly limits: ToolResultLimits;
}
