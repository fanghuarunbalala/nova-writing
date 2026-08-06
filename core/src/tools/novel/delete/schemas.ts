/** Shared TypeBox schemas and JSON contracts for the unified Novel Delete tool. */
import { Type, type Static } from "typebox";

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
  readonly status: "deleted" | "not_found" | "rejected";
  readonly sequence?: number;
  readonly reason?: string;
};

export type NovelDeleteDetails = {
  readonly items: NovelDeleteItemDetails[];
};
