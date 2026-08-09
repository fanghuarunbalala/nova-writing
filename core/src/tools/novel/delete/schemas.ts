/** Shared TypeBox schemas and JSON contracts for the unified Novel Delete tool. */
import { Type, type Static } from "typebox";
import type { JsonValue } from "../../../event/index.js";

const ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$";

export const NovelDeleteKindSchema = Type.Union([
  Type.Literal("story_unit"),
  Type.Literal("character"),
  Type.Literal("location"),
  Type.Literal("paragraph"),
  Type.Literal("volume"),
  Type.Literal("chapter"),
]);
export type NovelDeleteKind = Static<typeof NovelDeleteKindSchema>;

export const NovelDeleteParametersSchema = Type.Object(
  {
    baseRevision: Type.String({ minLength: 1, maxLength: 128 }),
    cascade: Type.Optional(Type.Boolean({ default: false })),
    values: Type.Array(
      Type.Object(
        {
          kind: NovelDeleteKindSchema,
          id: Type.String({ pattern: ID_PATTERN }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 64 },
    ),
  },
  { additionalProperties: false },
);
export type NovelDeleteArguments = Static<typeof NovelDeleteParametersSchema>;

export type NovelDeleteItemDetails = {
  readonly kind: NovelDeleteKind;
  readonly id: string;
  readonly status: "applied" | "rejected";
  readonly reason?: string;
};

/**
 * One entity that was actually deleted by this call, with its complete model
 * record. Cascade deletes expand to one entry per affected entity (story unit
 * subtree, volume chapters, paragraphs), deduplicated across the batch.
 *
 * `data` holds the complete model record (StoryUnit / Paragraph /
 * PublicationVolume / PublicationChapter / Character / Location). It is typed
 * as JsonValue here because the contract must be JSON-serializable; the service
 * fills it with the frozen domain model value.
 */
export type NovelDeletedEntity = {
  readonly kind: NovelDeleteKind;
  readonly data: JsonValue;
};

/** Structured error content returned in-band so the provider can see it this turn. */
export type NovelDeleteErrorDetails = {
  readonly failure: string;
  readonly entityType?: string;
  readonly entityId?: string;
};

export type NovelDeleteDetails = {
  readonly items: NovelDeleteItemDetails[];
  readonly deleted?: NovelDeletedEntity[];
  readonly error?: NovelDeleteErrorDetails;
  readonly revision: { readonly currentRevision: string };
};
