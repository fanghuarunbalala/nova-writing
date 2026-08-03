/** Captures human-readable Story time with optional coarse chronology. */
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../../error/index.js";
import {
  captureOrderKey,
  compareOrderKeys,
  type OrderKey,
} from "./OrderKey.js";

export interface StoryTimeDescription {
  readonly description: string;
  readonly timelineOrderKey?: OrderKey;
}

const STORY_TIME_KEYS = new Set(["description", "timelineOrderKey"]);

export function captureStoryTimeDescription(
  value: unknown,
): StoryTimeDescription {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !STORY_TIME_KEYS.has(key))
  ) {
    throw invalidStoryTime();
  }
  const candidate = value as Record<string, unknown>;
  const timelineOrderKey =
    candidate.timelineOrderKey === undefined
      ? undefined
      : captureOrderKey(candidate.timelineOrderKey);
  return Object.freeze({
    description: captureDescription(candidate.description),
    ...(timelineOrderKey === undefined ? {} : { timelineOrderKey }),
  });
}

export function compareStoryTimeDescriptions(
  leftInput: StoryTimeDescription,
  rightInput: StoryTimeDescription,
): number | undefined {
  const left = captureStoryTimeDescription(leftInput);
  const right = captureStoryTimeDescription(rightInput);
  if (
    left.timelineOrderKey === undefined ||
    right.timelineOrderKey === undefined
  ) {
    return undefined;
  }
  return compareOrderKeys(left.timelineOrderKey, right.timelineOrderKey);
}

function captureDescription(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 20_000 ||
    value.trim() !== value ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value)
  ) {
    throw invalidStoryTime();
  }
  return value;
}

function invalidStoryTime(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidStoryTime,
    "storyTimeDescription",
  );
}
