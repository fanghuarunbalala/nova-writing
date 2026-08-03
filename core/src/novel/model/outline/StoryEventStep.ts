/** Captures objective ordered events that manuscript realization must satisfy. */
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../../error/index.js";
import {
  captureStoryEventStepId,
  captureStoryUnitId,
  type StoryEventStepId,
  type StoryUnitId,
} from "../../identity/index.js";
import {
  captureOrderKey,
  compareOrderKeys,
  type OrderKey,
} from "./OrderKey.js";

export interface StoryEventStep {
  readonly id: StoryEventStepId;
  readonly storyUnitId: StoryUnitId;
  readonly orderKey: OrderKey;
  readonly description: string;
}

const STORY_EVENT_KEYS = new Set([
  "id",
  "storyUnitId",
  "orderKey",
  "description",
]);

export function captureStoryEventStep(value: unknown): StoryEventStep {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== STORY_EVENT_KEYS.size ||
    Object.keys(value).some((key) => !STORY_EVENT_KEYS.has(key))
  ) {
    throw invalidStoryEvent();
  }
  const candidate = value as Record<string, unknown>;
  return Object.freeze({
    id: captureStoryEventStepId(candidate.id),
    storyUnitId: captureStoryUnitId(candidate.storyUnitId),
    orderKey: captureOrderKey(candidate.orderKey),
    description: captureDescription(candidate.description),
  });
}

export function captureOrderedStoryEventSteps(
  storyUnitIdInput: StoryUnitId,
  value: unknown,
): readonly StoryEventStep[] {
  const storyUnitId = captureStoryUnitId(storyUnitIdInput);
  if (!Array.isArray(value)) throw invalidStoryEvent();
  const events = value.map(captureStoryEventStep);
  const eventIds = new Set<StoryEventStepId>();
  const orderKeys = new Set<OrderKey>();
  for (const event of events) {
    if (
      event.storyUnitId !== storyUnitId ||
      eventIds.has(event.id) ||
      orderKeys.has(event.orderKey)
    ) {
      throw invalidStoryEvent();
    }
    eventIds.add(event.id);
    orderKeys.add(event.orderKey);
  }
  return Object.freeze(
    events.sort((left, right) =>
      compareOrderKeys(left.orderKey, right.orderKey),
    ),
  );
}

function captureDescription(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 20_000 ||
    value.trim() !== value ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value)
  ) {
    throw invalidStoryEvent();
  }
  return value;
}

function invalidStoryEvent(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidStoryEvent,
    "storyEventStep",
  );
}
