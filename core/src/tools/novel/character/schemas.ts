/** Shared TypeBox schemas and tool-visible JSON contracts for Novel Character tools. */
import { Type, type Static } from "typebox";
import {
  ScopeSchema,
  type ToolScope,
} from "../outline/schemas.js";

export { ScopeSchema, type ToolScope };

const ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$";

export const CharacterProfileWriteSchema = Type.Object(
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
export type CharacterProfileWriteValue = Static<
  typeof CharacterProfileWriteSchema
>;

export const NovelCharacterReadParametersSchema = Type.Object(
  {
    scope: ScopeSchema,
    characterId: Type.Optional(Type.String({ pattern: ID_PATTERN })),
  },
  { additionalProperties: false },
);
export type NovelCharacterReadArguments = Static<
  typeof NovelCharacterReadParametersSchema
>;

export const NovelCharacterWriteParametersSchema = Type.Object(
  {
    values: Type.Array(CharacterProfileWriteSchema, {
      minItems: 1,
      maxItems: 64,
    }),
  },
  { additionalProperties: false },
);
export type NovelCharacterWriteArguments = Static<
  typeof NovelCharacterWriteParametersSchema
>;

export const NovelCharacterEditValueSchema = Type.Object(
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
export type NovelCharacterEditValue = Static<
  typeof NovelCharacterEditValueSchema
>;

export const NovelCharacterEditParametersSchema = Type.Object(
  {
    values: Type.Array(
      Type.Object(
        {
          id: Type.String({ pattern: ID_PATTERN }),
          value: NovelCharacterEditValueSchema,
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 64 },
    ),
  },
  { additionalProperties: false },
);
export type NovelCharacterEditArguments = Static<
  typeof NovelCharacterEditParametersSchema
>;

export type NovelCharacterDetails = {
  readonly id: string;
  readonly name: string;
  readonly aliases: string[];
  readonly summary?: string;
  readonly initialState?: string;
  readonly authorNotes?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type NovelCharacterReadDetails = {
  readonly characters: NovelCharacterDetails[];
};

export type NovelCharacterItemDetails = {
  readonly id: string;
  readonly status: "appended" | "duplicate" | "rejected";
  readonly sequence?: number;
  readonly reason?: string;
};

export type NovelCharacterWriteDetails = {
  readonly items: NovelCharacterItemDetails[];
};
