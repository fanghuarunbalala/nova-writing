import assert from "node:assert/strict";
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
  RHYTHM_DIRECTION,
  RandomStoryIdentityFactory,
  captureOrderKey,
  captureOrderedRhythmBeats,
  captureRhythmBeat,
  captureRhythmBeatId,
  captureStoryEventStepId,
  captureStoryUnitId,
} from "../dist/index.js";

assert.match(
  new RandomStoryIdentityFactory().createRhythmBeatId(),
  /^rhythm_beat_[a-f0-9]{32}$/u,
);

const storyUnitId = captureStoryUnitId("story_unit_rhythm_smoke");
const firstEventId = captureStoryEventStepId("story_event_rhythm_first");
const secondEventId = captureStoryEventStepId("story_event_rhythm_second");
const rise = captureRhythmBeat({
  id: captureRhythmBeatId("rhythm_beat_rise"),
  storyUnitId,
  orderKey: captureOrderKey("4000"),
  rhythm: RHYTHM_DIRECTION.rise,
  intensity: 3,
  readerEmotion: "Growing suspicion",
  pointOfViewEmotion: "Defensive confidence",
  relatedEventIds: [firstEventId],
});
const turn = captureRhythmBeat({
  id: captureRhythmBeatId("rhythm_beat_turn"),
  storyUnitId,
  orderKey: captureOrderKey("8000"),
  rhythm: RHYTHM_DIRECTION.turn,
  intensity: 5,
  description: "The apparent victory becomes a trap.",
  relatedEventIds: [firstEventId, secondEventId],
});
assert.equal(Object.isFrozen(rise), true);
assert.equal(Object.isFrozen(rise.relatedEventIds), true);
const ordered = captureOrderedRhythmBeats(
  storyUnitId,
  [firstEventId, secondEventId],
  [turn, rise],
);
assert.deepEqual(ordered.map((beat) => beat.id), [rise.id, turn.id]);

for (const invalid of [
  { ...rise, rhythm: "surprise" },
  { ...rise, intensity: 0 },
  { ...rise, intensity: 6 },
  { ...rise, intensity: 2.5 },
  { ...rise, relatedEventIds: [firstEventId, firstEventId] },
  { ...rise, unknown: true },
]) {
  assertRhythmFailure(() => captureRhythmBeat(invalid));
}
for (const invalidBeats of [
  [rise, rise],
  [rise, { ...turn, orderKey: rise.orderKey }],
  [rise, { ...turn, storyUnitId: "story_unit_other" }],
  [rise, { ...turn, relatedEventIds: ["story_event_missing"] }],
]) {
  assertRhythmFailure(() =>
    captureOrderedRhythmBeats(
      storyUnitId,
      [firstEventId, secondEventId],
      invalidBeats,
    ),
  );
}

console.log("novel rhythm beat smoke passed");

function assertRhythmFailure(invoke) {
  assert.throws(invoke, (error) => {
    assert.equal(error instanceof NovelProtocolValidationError, true);
    assert.equal(error.failure, NOVEL_PROTOCOL_FAILURE.invalidRhythmBeat);
    assert.equal(error.field, "rhythmBeat");
    return true;
  });
}
