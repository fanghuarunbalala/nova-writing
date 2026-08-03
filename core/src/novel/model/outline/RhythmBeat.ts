/** Captures ordered emotional rhythm separately from objective Story Events. */
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../../error/index.js";
import {
  captureRhythmBeatId,
  captureStoryEventStepId,
  captureStoryUnitId,
  type RhythmBeatId,
  type StoryEventStepId,
  type StoryUnitId,
} from "../../identity/index.js";
import {
  captureOrderKey,
  compareOrderKeys,
  type OrderKey,
} from "./OrderKey.js";

export const RHYTHM_DIRECTION = {
  setup: "setup",
  rise: "rise",
  hold: "hold",
  turn: "turn",
  climax: "climax",
  fall: "fall",
  release: "release",
  aftermath: "aftermath",
} as const;
export type RhythmDirection =
  (typeof RHYTHM_DIRECTION)[keyof typeof RHYTHM_DIRECTION];
export type RhythmIntensity = 1 | 2 | 3 | 4 | 5;

export interface RhythmBeat {
  readonly id: RhythmBeatId;
  readonly storyUnitId: StoryUnitId;
  readonly orderKey: OrderKey;
  readonly rhythm: RhythmDirection;
  readonly intensity: RhythmIntensity;
  readonly readerEmotion?: string;
  readonly pointOfViewEmotion?: string;
  readonly description?: string;
  readonly relatedEventIds: readonly StoryEventStepId[];
}

const RHYTHM_BEAT_KEYS = new Set([
  "id",
  "storyUnitId",
  "orderKey",
  "rhythm",
  "intensity",
  "readerEmotion",
  "pointOfViewEmotion",
  "description",
  "relatedEventIds",
]);
const RHYTHM_DIRECTIONS = new Set<unknown>(Object.values(RHYTHM_DIRECTION));

export function captureRhythmBeat(value: unknown): RhythmBeat {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !RHYTHM_BEAT_KEYS.has(key))
  ) {
    throw invalidRhythmBeat();
  }
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.relatedEventIds)) throw invalidRhythmBeat();
  const relatedEventIds = candidate.relatedEventIds.map(captureStoryEventStepId);
  if (new Set(relatedEventIds).size !== relatedEventIds.length) {
    throw invalidRhythmBeat();
  }
  return Object.freeze({
    id: captureRhythmBeatId(candidate.id),
    storyUnitId: captureStoryUnitId(candidate.storyUnitId),
    orderKey: captureOrderKey(candidate.orderKey),
    rhythm: captureRhythmDirection(candidate.rhythm),
    intensity: captureRhythmIntensity(candidate.intensity),
    ...captureOptionalText("readerEmotion", candidate.readerEmotion),
    ...captureOptionalText("pointOfViewEmotion", candidate.pointOfViewEmotion),
    ...captureOptionalText("description", candidate.description),
    relatedEventIds: Object.freeze(relatedEventIds),
  });
}

export function captureOrderedRhythmBeats(
  storyUnitIdInput: StoryUnitId,
  availableEventIdsInput: readonly StoryEventStepId[],
  value: unknown,
): readonly RhythmBeat[] {
  const storyUnitId = captureStoryUnitId(storyUnitIdInput);
  const availableEventIds = new Set(
    availableEventIdsInput.map(captureStoryEventStepId),
  );
  if (!Array.isArray(value)) throw invalidRhythmBeat();
  const beats = value.map(captureRhythmBeat);
  const beatIds = new Set<RhythmBeatId>();
  const orderKeys = new Set<OrderKey>();
  for (const beat of beats) {
    if (
      beat.storyUnitId !== storyUnitId ||
      beatIds.has(beat.id) ||
      orderKeys.has(beat.orderKey) ||
      beat.relatedEventIds.some((eventId) => !availableEventIds.has(eventId))
    ) {
      throw invalidRhythmBeat();
    }
    beatIds.add(beat.id);
    orderKeys.add(beat.orderKey);
  }
  return Object.freeze(
    beats.sort((left, right) =>
      compareOrderKeys(left.orderKey, right.orderKey),
    ),
  );
}

function captureRhythmDirection(value: unknown): RhythmDirection {
  if (!RHYTHM_DIRECTIONS.has(value)) throw invalidRhythmBeat();
  return value as RhythmDirection;
}

function captureRhythmIntensity(value: unknown): RhythmIntensity {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 5) {
    throw invalidRhythmBeat();
  }
  return value as RhythmIntensity;
}

function captureOptionalText(
  field: "readerEmotion" | "pointOfViewEmotion" | "description",
  value: unknown,
): Partial<RhythmBeat> {
  if (value === undefined) return {};
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 20_000 ||
    value.trim().length === 0 ||
    /\u0000/u.test(value)
  ) {
    throw invalidRhythmBeat();
  }
  return { [field]: value };
}

function invalidRhythmBeat(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidRhythmBeat,
    "rhythmBeat",
  );
}
