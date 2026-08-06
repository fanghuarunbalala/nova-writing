/** Shared TypeBox schemas and tool-visible JSON contracts for Novel Location tools. */
import { Type, type Static } from "typebox";

const ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$";

export const LocationProfileWriteSchema = Type.Object(
  {
    id: Type.Optional(Type.String({ pattern: ID_PATTERN })),
    name: Type.String({ minLength: 1, maxLength: 200 }),
    aliases: Type.Array(Type.String({ minLength: 1, maxLength: 200 }), {
      maxItems: 32,
    }),
    summary: Type.Optional(Type.String({ maxLength: 20_000 })),
    initialState: Type.Optional(Type.String({ maxLength: 20_000 })),
    authorNotes: Type.Optional(Type.String({ maxLength: 50_000 })),
  },
  { additionalProperties: false },
);
export type LocationProfileWriteValue = Static<
  typeof LocationProfileWriteSchema
>;

export const NovelLocationReadParametersSchema = Type.Object(
  {
    locationId: Type.Optional(Type.String({ pattern: ID_PATTERN })),
  },
  { additionalProperties: false },
);
export type NovelLocationReadArguments = Static<
  typeof NovelLocationReadParametersSchema
>;

export const NovelLocationWriteParametersSchema = Type.Object(
  {
    baseRevision: Type.Optional(
      Type.String({ minLength: 1, maxLength: 128 }),
    ),
    values: Type.Array(LocationProfileWriteSchema, {
      minItems: 1,
      maxItems: 64,
    }),
  },
  { additionalProperties: false },
);
export type NovelLocationWriteArguments = Static<
  typeof NovelLocationWriteParametersSchema
>;

export const NovelLocationEditValueSchema = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    aliases: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 200 }), {
        maxItems: 32,
      }),
    ),
    summary: Type.Optional(
      Type.Union([Type.Null(), Type.String({ maxLength: 20_000 })]),
    ),
    initialState: Type.Optional(
      Type.Union([Type.Null(), Type.String({ maxLength: 20_000 })]),
    ),
    authorNotes: Type.Optional(
      Type.Union([Type.Null(), Type.String({ maxLength: 50_000 })]),
    ),
  },
  { additionalProperties: false },
);
export type NovelLocationEditValue = Static<
  typeof NovelLocationEditValueSchema
>;

export const NovelLocationEditParametersSchema = Type.Object(
  {
    baseRevision: Type.Optional(
      Type.String({ minLength: 1, maxLength: 128 }),
    ),
    values: Type.Array(
      Type.Object(
        {
          id: Type.String({ pattern: ID_PATTERN }),
          value: NovelLocationEditValueSchema,
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 64 },
    ),
  },
  { additionalProperties: false },
);
export type NovelLocationEditArguments = Static<
  typeof NovelLocationEditParametersSchema
>;

export type NovelLocationDetails = {
  readonly id: string;
  readonly name: string;
  readonly aliases: string[];
  readonly summary?: string;
  readonly initialState?: string;
  readonly authorNotes?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type NovelLocationReadDetails = {
  readonly locations: NovelLocationDetails[];
  readonly revision: { readonly currentRevision: string };
};

export type NovelLocationItemDetails = {
  readonly id: string;
  readonly status: "applied" | "rejected";
  readonly reason?: string;
};

export type NovelLocationWriteDetails = {
  readonly items: NovelLocationItemDetails[];
  readonly revision: { readonly currentRevision: string };
};
