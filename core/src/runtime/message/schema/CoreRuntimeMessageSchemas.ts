/** Core schemas for Runtime Messages that are independent of any Agent adapter. */
import { Type } from "typebox";
import type { RuntimeMessageSchemaRegistry } from "../RuntimeMessageSchemaRegistry.js";
import { RUNTIME_MESSAGE_SCHEMA_VERSION } from "../RuntimeMessageSnapshot.js";

export const CORE_RUNTIME_MESSAGE_TYPE = {
  userMessage: "user.message",
} as const;

export const RuntimeTextContentSchema = Type.Object(
  {
    type: Type.Literal("text"),
    text: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const CoreUserRuntimeMessagePayloadSchema = Type.Object(
  {
    content: Type.Array(RuntimeTextContentSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);

export function registerCoreRuntimeMessageSchemas(
  registry: RuntimeMessageSchemaRegistry,
): void {
  registry.register({
    role: "user",
    messageType: CORE_RUNTIME_MESSAGE_TYPE.userMessage,
    schemaVersion: RUNTIME_MESSAGE_SCHEMA_VERSION,
    payloadSchema: CoreUserRuntimeMessagePayloadSchema,
  });
}
