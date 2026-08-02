/** Captures stable narrative work units independently from status and manuscript state. */
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../../error/index.js";
import {
  captureStoryOutlineId,
  captureStoryUnitId,
  type StoryOutlineId,
  type StoryUnitId,
} from "../../identity/index.js";
import { captureOrderKey, type OrderKey } from "./OrderKey.js";
import {
  STORY_UNIT_REALIZATION_STATUS,
  captureStoryUnitAbandonment,
  captureStoryUnitBlockState,
  captureStoryUnitPlanningStatus,
  captureStoryUnitRealizationStatus,
  type StoryUnitAbandonment,
  type StoryUnitBlockState,
  type StoryUnitPlanningStatus,
  type StoryUnitRealizationStatus,
} from "./StoryUnitStatus.js";

export const STORY_UNIT_SCOPE = {
  saga: "saga",
  arc: "arc",
  sequence: "sequence",
  scene: "scene",
  custom: "custom",
} as const;

export type StoryUnitScope =
  (typeof STORY_UNIT_SCOPE)[keyof typeof STORY_UNIT_SCOPE];

export interface StoryUnit {
  readonly id: StoryUnitId;
  readonly outlineId: StoryOutlineId;
  readonly parentId?: StoryUnitId;
  readonly orderKey: OrderKey;
  readonly title: string;
  readonly intent?: string;
  readonly synopsis?: string;
  readonly scope?: StoryUnitScope;
  readonly planningStatus: StoryUnitPlanningStatus;
  readonly realizationStatus: StoryUnitRealizationStatus;
  readonly blockState?: StoryUnitBlockState;
  readonly abandonment?: StoryUnitAbandonment;
}

const STORY_UNIT_KEYS = new Set([
  "id",
  "outlineId",
  "parentId",
  "orderKey",
  "title",
  "intent",
  "synopsis",
  "scope",
  "planningStatus",
  "realizationStatus",
  "blockState",
  "abandonment",
]);
const STORY_UNIT_SCOPES = new Set<unknown>(Object.values(STORY_UNIT_SCOPE));

export function captureStoryUnit(value: unknown): StoryUnit {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !STORY_UNIT_KEYS.has(key))
  ) {
    throw invalidStoryUnit();
  }
  const candidate = value as Record<string, unknown>;
  const parentId =
    candidate.parentId === undefined
      ? undefined
      : captureStoryUnitId(candidate.parentId);
  const scope = captureScope(candidate.scope);
  const planningStatus = captureStoryUnitPlanningStatus(candidate.planningStatus);
  const realizationStatus = captureStoryUnitRealizationStatus(
    candidate.realizationStatus,
  );
  const blockState =
    candidate.blockState === undefined
      ? undefined
      : captureStoryUnitBlockState(candidate.blockState);
  const abandonment =
    candidate.abandonment === undefined
      ? undefined
      : captureStoryUnitAbandonment(candidate.abandonment);
  assertCurrentState(realizationStatus, blockState, abandonment);
  return Object.freeze({
    id: captureStoryUnitId(candidate.id),
    outlineId: captureStoryOutlineId(candidate.outlineId),
    ...(parentId === undefined ? {} : { parentId }),
    orderKey: captureOrderKey(candidate.orderKey),
    title: captureTitle(candidate.title),
    ...captureOptionalText("intent", candidate.intent, 20_000),
    ...captureOptionalText("synopsis", candidate.synopsis, 50_000),
    ...(scope === undefined ? {} : { scope }),
    planningStatus,
    realizationStatus,
    ...(blockState === undefined ? {} : { blockState }),
    ...(abandonment === undefined ? {} : { abandonment }),
  });
}

function assertCurrentState(
  realizationStatus: StoryUnitRealizationStatus,
  blockState: StoryUnitBlockState | undefined,
  abandonment: StoryUnitAbandonment | undefined,
): void {
  if (realizationStatus === STORY_UNIT_REALIZATION_STATUS.abandoned) {
    if (abandonment === undefined || blockState !== undefined) {
      throw invalidStoryUnit();
    }
    return;
  }
  if (abandonment !== undefined) throw invalidStoryUnit();
  if (
    realizationStatus === STORY_UNIT_REALIZATION_STATUS.completed &&
    blockState !== undefined
  ) {
    throw invalidStoryUnit();
  }
}

function captureTitle(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 500 ||
    value.trim() !== value ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value)
  ) {
    throw invalidStoryUnit();
  }
  return value;
}

function captureOptionalText(
  field: "intent" | "synopsis",
  value: unknown,
  maximumLength: number,
): Partial<StoryUnit> {
  if (value === undefined) return {};
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    value.trim().length === 0 ||
    /\u0000/u.test(value)
  ) {
    throw invalidStoryUnit();
  }
  return { [field]: value };
}

function captureScope(value: unknown): StoryUnitScope | undefined {
  if (value === undefined) return undefined;
  if (!STORY_UNIT_SCOPES.has(value)) throw invalidStoryUnit();
  return value as StoryUnitScope;
}

function invalidStoryUnit(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidStoryUnit,
    "storyUnit",
  );
}
