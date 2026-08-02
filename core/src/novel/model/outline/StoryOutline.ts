/** Captures one Novel-owned Story Outline identity without persistence details. */
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../../error/index.js";
import {
  captureNovelId,
  captureStoryOutlineId,
  type NovelId,
  type StoryOutlineId,
} from "../../identity/index.js";

export interface StoryOutline {
  readonly id: StoryOutlineId;
  readonly novelId: NovelId;
}

const STORY_OUTLINE_KEYS = new Set(["id", "novelId"]);

export function captureStoryOutline(value: unknown): StoryOutline {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !STORY_OUTLINE_KEYS.has(key))
  ) {
    throw invalidStoryOutline();
  }
  const candidate = value as Record<string, unknown>;
  return Object.freeze({
    id: captureStoryOutlineId(candidate.id),
    novelId: captureNovelId(candidate.novelId),
  });
}

function invalidStoryOutline(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidStoryOutline,
    "storyOutline",
  );
}
