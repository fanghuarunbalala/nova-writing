/** Shared TypeBox schemas and tool-visible JSON contracts for Novel Outline tools. */
import { Type, type Static } from "typebox";

const ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$";
const ORDER_KEY_PATTERN = "^(?:[0-9A-F]{4})+$";

const StoryUnitScopeSchema = Type.Union([
  Type.Literal("saga"),
  Type.Literal("arc"),
  Type.Literal("sequence"),
  Type.Literal("scene"),
  Type.Literal("custom"),
]);

/** 暂存兼容导出：draft scope 已废弃，其余工具组切换完成后移除。 */
export const ScopeSchema = Type.Union([
  Type.Literal("canonical"),
  Type.Literal("draft"),
]);
export type ToolScope = Static<typeof ScopeSchema>;

const PlanningStatusSchema = Type.Union([
  Type.Literal("idea"),
  Type.Literal("outlined"),
  Type.Literal("ready"),
]);

const RealizationStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("in-progress"),
  Type.Literal("completed"),
  Type.Literal("abandoned"),
]);

const BlockReasonCodeSchema = Type.Union([
  Type.Literal("dependency"),
  Type.Literal("decision-required"),
  Type.Literal("continuity-conflict"),
  Type.Literal("missing-material"),
  Type.Literal("outline-incomplete"),
  Type.Literal("other"),
]);

const AbandonReasonCodeSchema = Type.Union([
  Type.Literal("story-direction-changed"),
  Type.Literal("replaced"),
  Type.Literal("merged"),
  Type.Literal("duplicate"),
  Type.Literal("scope-reduced"),
  Type.Literal("other"),
]);

const BlockStateSchema = Type.Object(
  {
    reasonCode: Type.Optional(BlockReasonCodeSchema),
    note: Type.Optional(Type.String({ maxLength: 20_000 })),
    dependencyIds: Type.Array(Type.String({ pattern: ID_PATTERN }), {
      maxItems: 64,
    }),
    blockedAt: Type.String({ minLength: 1, maxLength: 64 }),
  },
  { additionalProperties: false },
);

const AbandonmentSchema = Type.Object(
  {
    reasonCode: Type.Optional(AbandonReasonCodeSchema),
    note: Type.Optional(Type.String({ maxLength: 20_000 })),
    replacementStoryUnitId: Type.Optional(
      Type.String({ pattern: ID_PATTERN }),
    ),
    abandonedAt: Type.String({ minLength: 1, maxLength: 64 }),
  },
  { additionalProperties: false },
);

const CharacterInvolvementSchema = Type.Object(
  {
    presence: Type.Union([
      Type.Literal("present"),
      Type.Literal("offstage"),
      Type.Literal("mentioned"),
    ]),
    roles: Type.Array(
      Type.Union([
        Type.Literal("point-of-view"),
        Type.Literal("participant"),
        Type.Literal("observer"),
        Type.Literal("affected"),
      ]),
      { maxItems: 4 },
    ),
  },
  { additionalProperties: false },
);

const CharacterBindingWriteSchema = Type.Object(
  {
    characterId: Type.String({ pattern: ID_PATTERN }),
    involvement: Type.Optional(CharacterInvolvementSchema),
    note: Type.Optional(Type.String({ maxLength: 20_000 })),
  },
  { additionalProperties: false },
);

const LocationInvolvementSchema = Type.Object(
  {
    role: Type.Union([
      Type.Literal("primary"),
      Type.Literal("secondary"),
      Type.Literal("mentioned"),
    ]),
    affected: Type.Boolean(),
  },
  { additionalProperties: false },
);

const LocationBindingWriteSchema = Type.Object(
  {
    locationId: Type.String({ pattern: ID_PATTERN }),
    involvement: Type.Optional(LocationInvolvementSchema),
    note: Type.Optional(Type.String({ maxLength: 20_000 })),
  },
  { additionalProperties: false },
);

const EventWriteSchema = Type.Object(
  {
    id: Type.String({ pattern: ID_PATTERN }),
    orderKey: Type.String({ minLength: 4, maxLength: 512 }),
    description: Type.String({ minLength: 1, maxLength: 20_000 }),
  },
  { additionalProperties: false },
);

const RhythmBeatWriteSchema = Type.Object(
  {
    id: Type.String({ pattern: ID_PATTERN }),
    orderKey: Type.String({ minLength: 4, maxLength: 512 }),
    rhythm: Type.Union([
      Type.Literal("setup"),
      Type.Literal("rise"),
      Type.Literal("hold"),
      Type.Literal("turn"),
      Type.Literal("climax"),
      Type.Literal("fall"),
      Type.Literal("release"),
      Type.Literal("aftermath"),
    ]),
    intensity: Type.Integer({ minimum: 1, maximum: 5 }),
    readerEmotion: Type.Optional(Type.String({ maxLength: 20_000 })),
    pointOfViewEmotion: Type.Optional(Type.String({ maxLength: 20_000 })),
    description: Type.Optional(Type.String({ maxLength: 20_000 })),
    relatedEventIds: Type.Array(Type.String({ pattern: ID_PATTERN }), {
      maxItems: 64,
    }),
  },
  { additionalProperties: false },
);

const EntityChangeWriteSchema = Type.Object(
  {
    id: Type.String({ pattern: ID_PATTERN }),
    entityType: Type.Union([
      Type.Literal("character"),
      Type.Literal("location"),
    ]),
    entityId: Type.String({ pattern: ID_PATTERN }),
    relatedEntityId: Type.Optional(Type.String({ pattern: ID_PATTERN })),
    category: Type.Union([
      Type.Literal("identity"),
      Type.Literal("condition"),
      Type.Literal("location"),
      Type.Literal("relationship"),
      Type.Literal("knowledge"),
      Type.Literal("goal"),
      Type.Literal("ownership"),
      Type.Literal("environment"),
      Type.Literal("custom"),
    ]),
    summary: Type.String({ minLength: 1, maxLength: 20_000 }),
    sourceEventIds: Type.Array(Type.String({ pattern: ID_PATTERN }), {
      maxItems: 64,
    }),
  },
  { additionalProperties: false },
);

export const LeafPlanWriteSchema = Type.Object(
  {
    settingMode: Type.Union([
      Type.Literal("located"),
      Type.Literal("location-independent"),
    ]),
    time: Type.Optional(
      Type.Object(
        {
          description: Type.String({ minLength: 1, maxLength: 20_000 }),
          timelineOrderKey: Type.Optional(
            Type.String({ minLength: 4, maxLength: 512 }),
          ),
        },
        { additionalProperties: false },
      ),
    ),
    characters: Type.Array(CharacterBindingWriteSchema, { maxItems: 128 }),
    locations: Type.Array(LocationBindingWriteSchema, { maxItems: 128 }),
    events: Type.Array(EventWriteSchema, { maxItems: 512 }),
    rhythmBeats: Type.Array(RhythmBeatWriteSchema, { maxItems: 512 }),
    entityChanges: Type.Array(EntityChangeWriteSchema, { maxItems: 512 }),
  },
  { additionalProperties: false },
);
export type LeafPlanWriteValue = Static<typeof LeafPlanWriteSchema>;

export const StoryUnitWriteSchema = Type.Object(
  {
    id: Type.Optional(Type.String({ pattern: ID_PATTERN })),
    title: Type.String({ minLength: 1, maxLength: 500 }),
    intent: Type.Optional(Type.String({ maxLength: 20_000 })),
    synopsis: Type.Optional(Type.String({ maxLength: 50_000 })),
    scope: Type.Optional(StoryUnitScopeSchema),
    planningStatus: Type.Optional(PlanningStatusSchema),
    realizationStatus: Type.Optional(RealizationStatusSchema),
    parentId: Type.Optional(Type.String({ pattern: ID_PATTERN })),
    orderKey: Type.Optional(Type.String({ minLength: 4, maxLength: 512 })),
    blockState: Type.Optional(BlockStateSchema),
    abandonment: Type.Optional(AbandonmentSchema),
    leaf: Type.Optional(LeafPlanWriteSchema),
  },
  { additionalProperties: false },
);
export type StoryUnitWriteValue = Static<typeof StoryUnitWriteSchema>;

const PartialLeafPlanWriteSchema = Type.Object(
  {
    settingMode: Type.Optional(
      Type.Union([
        Type.Literal("located"),
        Type.Literal("location-independent"),
      ]),
    ),
    time: Type.Optional(
      Type.Union([
        Type.Null(),
        Type.Object(
          {
            description: Type.String({ minLength: 1, maxLength: 20_000 }),
            timelineOrderKey: Type.Optional(
              Type.String({ minLength: 4, maxLength: 512 }),
            ),
          },
          { additionalProperties: false },
        ),
      ]),
    ),
    characters: Type.Optional(
      Type.Union([Type.Null(), Type.Array(CharacterBindingWriteSchema)]),
    ),
    locations: Type.Optional(
      Type.Union([Type.Null(), Type.Array(LocationBindingWriteSchema)]),
    ),
    events: Type.Optional(Type.Union([Type.Null(), Type.Array(EventWriteSchema)])),
    rhythmBeats: Type.Optional(
      Type.Union([Type.Null(), Type.Array(RhythmBeatWriteSchema)]),
    ),
    entityChanges: Type.Optional(
      Type.Union([Type.Null(), Type.Array(EntityChangeWriteSchema)]),
    ),
  },
  { additionalProperties: false },
);

export const NovelOutlineReadParametersSchema = Type.Object(
  {
    storyUnitId: Type.Optional(Type.String({ pattern: ID_PATTERN })),
    includePlans: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type NovelOutlineReadArguments = Static<
  typeof NovelOutlineReadParametersSchema
>;

export const NovelOutlineWriteParametersSchema = Type.Object(
  {
    baseRevision: Type.Optional(
      Type.String({ minLength: 1, maxLength: 128 }),
    ),
    values: Type.Array(StoryUnitWriteSchema, { minItems: 1, maxItems: 64 }),
  },
  { additionalProperties: false },
);
export type NovelOutlineWriteArguments = Static<
  typeof NovelOutlineWriteParametersSchema
>;

export const NovelOutlineEditValueSchema = Type.Object(
  {
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
    intent: Type.Optional(
      Type.Union([Type.Null(), Type.String({ maxLength: 20_000 })]),
    ),
    synopsis: Type.Optional(
      Type.Union([Type.Null(), Type.String({ maxLength: 50_000 })]),
    ),
    scope: Type.Optional(
      Type.Union([Type.Null(), StoryUnitScopeSchema]),
    ),
    planningStatus: Type.Optional(PlanningStatusSchema),
    realizationStatus: Type.Optional(RealizationStatusSchema),
    parentId: Type.Optional(
      Type.Union([Type.Null(), Type.String({ pattern: ID_PATTERN })]),
    ),
    orderKey: Type.Optional(
      Type.String({ minLength: 4, maxLength: 512 }),
    ),
    blockState: Type.Optional(Type.Union([Type.Null(), BlockStateSchema])),
    abandonment: Type.Optional(Type.Union([Type.Null(), AbandonmentSchema])),
    leaf: Type.Optional(
      Type.Union([Type.Null(), PartialLeafPlanWriteSchema]),
    ),
  },
  { additionalProperties: false },
);
export type NovelOutlineEditValue = Static<typeof NovelOutlineEditValueSchema>;

export const NovelOutlineEditParametersSchema = Type.Object(
  {
    baseRevision: Type.Optional(
      Type.String({ minLength: 1, maxLength: 128 }),
    ),
    values: Type.Array(
      Type.Object(
        {
          id: Type.String({ pattern: ID_PATTERN }),
          value: NovelOutlineEditValueSchema,
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 64 },
    ),
  },
  { additionalProperties: false },
);
export type NovelOutlineEditArguments = Static<
  typeof NovelOutlineEditParametersSchema
>;

/** Tool-visible leaf plan JSON shape without any storyUnitId fields. */
export type LeafPlanToolValue = {
  readonly settingMode: "located" | "location-independent";
  readonly time?: { readonly description: string; readonly timelineOrderKey?: string };
  readonly characters: {
    readonly characterId: string;
    readonly involvement?: {
      readonly presence: string;
      readonly roles: string[];
    };
    readonly note?: string;
  }[];
  readonly locations: {
    readonly locationId: string;
    readonly involvement?: { readonly role: string; readonly affected: boolean };
    readonly note?: string;
  }[];
  readonly events: {
    readonly id: string;
    readonly orderKey: string;
    readonly description: string;
  }[];
  readonly rhythmBeats: {
    readonly id: string;
    readonly orderKey: string;
    readonly rhythm: string;
    readonly intensity: number;
    readonly readerEmotion?: string;
    readonly pointOfViewEmotion?: string;
    readonly description?: string;
    readonly relatedEventIds: string[];
  }[];
  readonly entityChanges: {
    readonly id: string;
    readonly entityType: "character" | "location";
    readonly entityId: string;
    readonly relatedEntityId?: string;
    readonly category: string;
    readonly summary: string;
    readonly sourceEventIds: string[];
  }[];
};

/** Tool-visible read result details (JSON-safe). */
export type NovelOutlineUnitDetails = {
  readonly id: string;
  readonly outlineId: string;
  readonly parentId?: string;
  readonly orderKey: string;
  readonly title: string;
  readonly intent?: string;
  readonly synopsis?: string;
  readonly scope?: string;
  readonly planningStatus: string;
  readonly realizationStatus: string;
  readonly blockState?: {
    readonly reasonCode?: string;
    readonly note?: string;
    readonly dependencyIds: string[];
    readonly blockedAt: string;
  };
  readonly abandonment?: {
    readonly reasonCode?: string;
    readonly note?: string;
    readonly replacementStoryUnitId?: string;
    readonly abandonedAt: string;
  };
  plan?: LeafPlanToolValue;
  progress?: {
    readonly effectiveStatus: string;
    readonly isBlocked: boolean;
    readonly completedLeafCount: number;
    readonly totalLeafCount: number;
  };
};

export type NovelOutlineReadDetails = {
  readonly outline?: { readonly id: string; readonly novelId: string };
  readonly units: NovelOutlineUnitDetails[];
  readonly revision: { readonly currentRevision: string };
};

export type NovelOutlineItemDetails = {
  readonly id: string;
  readonly status: "applied" | "rejected";
  readonly reason?: string;
};

export type NovelOutlineWriteDetails = {
  readonly items: NovelOutlineItemDetails[];
  readonly revision: { readonly currentRevision: string };
};
