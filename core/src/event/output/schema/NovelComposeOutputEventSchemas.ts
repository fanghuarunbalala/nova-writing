/** novel.compose.* 输出事件的公开 payload schema。 */
/** Public payload schemas for the novel.compose.* output events. */
import { Type } from "typebox";
import { EVENT_SCHEMA_VERSION } from "../../protocol/EventMetadata.js";
import type { EventSchemaRegistry } from "../../protocol/EventSchemaRegistry.js";
import { OUTPUT_EVENT_TYPE } from "../OutputEventType.js";

const ComposePhase = Type.Union([
  Type.Literal("idle"),
  Type.Literal("designing"),
  Type.Literal("pending"),
  Type.Literal("applied"),
  Type.Literal("discarded"),
]);

const ComposePayload = Type.Object(
  {
    composeVersion: Type.Literal(1),
    designFilePath: Type.String({ minLength: 1, maxLength: 1024 }),
    phase: ComposePhase,
    approvalRequestId: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
    preComposeMode: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  },
  { additionalProperties: false },
);

export function registerNovelComposeOutputEventSchemas(
  registry: EventSchemaRegistry,
): void {
  const definitions = [
    OUTPUT_EVENT_TYPE.novelComposeBegin,
    OUTPUT_EVENT_TYPE.novelComposeSubmitted,
    OUTPUT_EVENT_TYPE.novelComposeApproved,
    OUTPUT_EVENT_TYPE.novelComposeRejected,
    OUTPUT_EVENT_TYPE.novelComposeApplied,
    OUTPUT_EVENT_TYPE.novelComposeDiscarded,
  ] as const;
  for (const eventType of definitions) {
    registry.register({
      kind: "output",
      eventType,
      schemaVersion: EVENT_SCHEMA_VERSION,
      payloadSchema: ComposePayload,
    });
  }
}
