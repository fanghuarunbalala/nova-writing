/** Shared TypeBox schemas and tool-visible JSON contracts for Novel Paragraph tools. */
import { Type, type Static } from "typebox";
import {
  ScopeSchema,
  type ToolScope,
} from "../outline/schemas.js";

export { ScopeSchema, type ToolScope };

const ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$";
const ORDER_KEY_PATTERN = "^(?:[0-9A-F]{4})+$";
const TEXT_MAX = 1_000_000;

export const ParagraphWriteSchema = Type.Object(
  {
    id: Type.Optional(Type.String({ pattern: ID_PATTERN })),
    storyUnitId: Type.String({ pattern: ID_PATTERN }),
    orderKey: Type.Optional(Type.String({ pattern: ORDER_KEY_PATTERN })),
    text: Type.String({ maxLength: TEXT_MAX }),
  },
  { additionalProperties: false },
);
export type ParagraphWriteValue = Static<typeof ParagraphWriteSchema>;

export const NovelParagraphReadParametersSchema = Type.Object(
  {
    scope: ScopeSchema,
    storyUnitId: Type.Optional(Type.String({ pattern: ID_PATTERN })),
  },
  { additionalProperties: false },
);
export type NovelParagraphReadArguments = Static<
  typeof NovelParagraphReadParametersSchema
>;

export const NovelParagraphWriteParametersSchema = Type.Object(
  {
    values: Type.Array(ParagraphWriteSchema, {
      minItems: 1,
      maxItems: 64,
    }),
  },
  { additionalProperties: false },
);
export type NovelParagraphWriteArguments = Static<
  typeof NovelParagraphWriteParametersSchema
>;

export const NovelParagraphEditValueSchema = Type.Object(
  {
    storyUnitId: Type.Optional(Type.String({ pattern: ID_PATTERN })),
    orderKey: Type.Optional(Type.String({ pattern: ORDER_KEY_PATTERN })),
    text: Type.Optional(Type.String({ maxLength: TEXT_MAX })),
  },
  { additionalProperties: false },
);
export type NovelParagraphEditValue = Static<
  typeof NovelParagraphEditValueSchema
>;

export const NovelParagraphEditParametersSchema = Type.Object(
  {
    values: Type.Array(
      Type.Object(
        {
          id: Type.String({ pattern: ID_PATTERN }),
          value: NovelParagraphEditValueSchema,
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 64 },
    ),
  },
  { additionalProperties: false },
);
export type NovelParagraphEditArguments = Static<
  typeof NovelParagraphEditParametersSchema
>;

export type NovelParagraphDetails = {
  readonly id: string;
  readonly storyUnitId: string;
  readonly orderKey: string;
  readonly text: string;
};

export type NovelParagraphReadDetails = {
  readonly paragraphs: NovelParagraphDetails[];
};

export type NovelParagraphItemDetails = {
  readonly id: string;
  readonly status: "appended" | "updated" | "duplicate" | "not_found" | "rejected";
  readonly sequence?: number;
  readonly reason?: string;
};

export type NovelParagraphWriteDetails = {
  readonly items: NovelParagraphItemDetails[];
};
