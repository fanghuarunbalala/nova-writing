/** Shared TypeBox schemas and JSON contracts for Novel Volume and Chapter tools. */
import { Type, type Static } from "typebox";
import {
  ScopeSchema,
  type ToolScope,
} from "../outline/schemas.js";

export { ScopeSchema, type ToolScope };

const ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$";
const ORDER_KEY_PATTERN = "^(?:[0-9A-F]{4})+$";
const TITLE_MAX = 1_000;

export const VolumeWriteSchema = Type.Object(
  {
    id: Type.Optional(Type.String({ pattern: ID_PATTERN })),
    title: Type.String({ minLength: 1, maxLength: TITLE_MAX }),
    orderKey: Type.Optional(Type.String({ pattern: ORDER_KEY_PATTERN })),
  },
  { additionalProperties: false },
);
export type VolumeWriteValue = Static<typeof VolumeWriteSchema>;

export const ChapterWriteSchema = Type.Object(
  {
    id: Type.Optional(Type.String({ pattern: ID_PATTERN })),
    volumeId: Type.String({ pattern: ID_PATTERN }),
    title: Type.Optional(Type.String({ minLength: 1, maxLength: TITLE_MAX })),
    orderKey: Type.Optional(Type.String({ pattern: ORDER_KEY_PATTERN })),
    paragraphIds: Type.Optional(
      Type.Array(Type.String({ pattern: ID_PATTERN }), { maxItems: 4_096 }),
    ),
  },
  { additionalProperties: false },
);
export type ChapterWriteValue = Static<typeof ChapterWriteSchema>;

export const NovelVolumeReadParametersSchema = Type.Object(
  {
    scope: ScopeSchema,
  },
  { additionalProperties: false },
);
export type NovelVolumeReadArguments = Static<
  typeof NovelVolumeReadParametersSchema
>;

export const NovelVolumeWriteParametersSchema = Type.Object(
  {
    values: Type.Array(VolumeWriteSchema, { minItems: 1, maxItems: 64 }),
  },
  { additionalProperties: false },
);
export type NovelVolumeWriteArguments = Static<
  typeof NovelVolumeWriteParametersSchema
>;

export const NovelVolumeEditValueSchema = Type.Object(
  {
    title: Type.Optional(Type.String({ minLength: 1, maxLength: TITLE_MAX })),
    orderKey: Type.Optional(Type.String({ pattern: ORDER_KEY_PATTERN })),
  },
  { additionalProperties: false },
);
export type NovelVolumeEditValue = Static<typeof NovelVolumeEditValueSchema>;

export const NovelVolumeEditParametersSchema = Type.Object(
  {
    values: Type.Array(
      Type.Object(
        {
          id: Type.String({ pattern: ID_PATTERN }),
          value: NovelVolumeEditValueSchema,
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 64 },
    ),
  },
  { additionalProperties: false },
);
export type NovelVolumeEditArguments = Static<
  typeof NovelVolumeEditParametersSchema
>;

export const NovelChapterReadParametersSchema = Type.Object(
  {
    scope: ScopeSchema,
    chapterId: Type.Optional(Type.String({ pattern: ID_PATTERN })),
    volumeId: Type.Optional(Type.String({ pattern: ID_PATTERN })),
    includeContent: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type NovelChapterReadArguments = Static<
  typeof NovelChapterReadParametersSchema
>;

export const NovelChapterWriteParametersSchema = Type.Object(
  {
    values: Type.Array(ChapterWriteSchema, { minItems: 1, maxItems: 64 }),
  },
  { additionalProperties: false },
);
export type NovelChapterWriteArguments = Static<
  typeof NovelChapterWriteParametersSchema
>;

export const NovelChapterEditValueSchema = Type.Object(
  {
    volumeId: Type.Optional(Type.String({ pattern: ID_PATTERN })),
    title: Type.Optional(Type.String({ minLength: 1, maxLength: TITLE_MAX })),
    orderKey: Type.Optional(Type.String({ pattern: ORDER_KEY_PATTERN })),
    paragraphIds: Type.Optional(
      Type.Union([
        Type.Null(),
        Type.Array(Type.String({ pattern: ID_PATTERN }), { maxItems: 4_096 }),
      ]),
    ),
  },
  { additionalProperties: false },
);
export type NovelChapterEditValue = Static<typeof NovelChapterEditValueSchema>;

export const NovelChapterEditParametersSchema = Type.Object(
  {
    values: Type.Array(
      Type.Object(
        {
          id: Type.String({ pattern: ID_PATTERN }),
          value: NovelChapterEditValueSchema,
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 64 },
    ),
  },
  { additionalProperties: false },
);
export type NovelChapterEditArguments = Static<
  typeof NovelChapterEditParametersSchema
>;

export type NovelChapterSummaryDetails = {
  readonly id: string;
  readonly title: string;
  readonly orderKey: string;
  readonly paragraphIds: string[];
};

export type NovelVolumeDetails = {
  readonly id: string;
  readonly title: string;
  readonly orderKey: string;
  readonly chapters: NovelChapterSummaryDetails[];
};

export type NovelVolumeReadDetails = {
  readonly volumes: NovelVolumeDetails[];
};

export type NovelChapterDetails = {
  readonly id: string;
  readonly volumeId: string;
  readonly title: string;
  readonly orderKey: string;
  readonly paragraphIds: string[];
  readonly content?: string;
  readonly paragraphs?: Array<{
    readonly id: string;
    readonly storyUnitId: string;
    readonly orderKey: string;
    readonly text: string;
  }>;
};

export type NovelChapterReadDetails = {
  readonly chapters: NovelChapterDetails[];
};

export type NovelPublicationItemDetails = {
  readonly id: string;
  readonly status: "appended" | "updated" | "duplicate" | "not_found" | "rejected";
  readonly sequence?: number;
  readonly reason?: string;
};

export type NovelVolumeWriteDetails = {
  readonly items: NovelPublicationItemDetails[];
};

export type NovelChapterWriteDetails = {
  readonly items: NovelPublicationItemDetails[];
};
