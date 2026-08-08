/** novel.mode.changed 输出事件的公开 payload schema。 */
/** Public payload schema for the novel.mode.changed output event. */
import { Type } from "typebox";
import { EVENT_SCHEMA_VERSION } from "../../protocol/EventMetadata.js";
import type { EventSchemaRegistry } from "../../protocol/EventSchemaRegistry.js";
import { OUTPUT_EVENT_TYPE } from "../OutputEventType.js";

const ConversationMode = Type.Union([
  Type.Literal("review"),
  Type.Literal("bypass"),
  Type.Literal("compose"),
]);

const ComposePhase = Type.Union([
  Type.Literal("idle"),
  Type.Literal("designing"),
  Type.Literal("pending"),
  Type.Literal("applied"),
  Type.Literal("discarded"),
]);

const ModeChangedPayload = Type.Object(
  {
    composeVersion: Type.Literal(1),
    mode: ConversationMode,
    designFilePath: Type.Optional(Type.String({ maxLength: 1024 })),
    phase: Type.Optional(ComposePhase),
    preComposeMode: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  },
  { additionalProperties: false },
);

export function registerNovelModeOutputEventSchemas(
  registry: EventSchemaRegistry,
): void {
  registry.register({
    kind: "output",
    eventType: OUTPUT_EVENT_TYPE.novelModeChanged,
    schemaVersion: EVENT_SCHEMA_VERSION,
    payloadSchema: ModeChangedPayload,
  });
}
