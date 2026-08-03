import assert from "node:assert/strict";
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
  RandomStoryIdentityFactory,
  captureOrderKey,
  captureOrderedStoryEventSteps,
  captureStoryEventStep,
  captureStoryEventStepId,
  captureStoryUnitId,
} from "../dist/index.js";

const generated = new RandomStoryIdentityFactory().createStoryEventStepId();
assert.match(generated, /^story_event_[a-f0-9]{32}$/u);

const storyUnitId = captureStoryUnitId("story_unit_event_smoke");
const first = captureStoryEventStep({
  id: captureStoryEventStepId("story_event_first"),
  storyUnitId,
  orderKey: captureOrderKey("4000"),
  description: "The protagonist discovers the locked room is empty.",
});
const second = captureStoryEventStep({
  id: captureStoryEventStepId("story_event_second"),
  storyUnitId,
  orderKey: captureOrderKey("8000"),
  description: "A hidden message redirects the investigation.",
});
assert.equal(Object.isFrozen(first), true);
const ordered = captureOrderedStoryEventSteps(storyUnitId, [second, first]);
assert.equal(Object.isFrozen(ordered), true);
assert.deepEqual(ordered.map((event) => event.id), [first.id, second.id]);

for (const invalid of [
  undefined,
  {},
  { ...first, description: "" },
  { ...first, description: " leading" },
  { ...first, unknown: true },
]) {
  assertStoryEventFailure(() => captureStoryEventStep(invalid));
}

for (const invalidEvents of [
  undefined,
  [first, first],
  [first, { ...second, orderKey: first.orderKey }],
  [first, { ...second, storyUnitId: "story_unit_other" }],
]) {
  assertStoryEventFailure(() =>
    captureOrderedStoryEventSteps(storyUnitId, invalidEvents),
  );
}

console.log("novel story event smoke passed");

function assertStoryEventFailure(invoke) {
  assert.throws(invoke, (error) => {
    assert.equal(error instanceof NovelProtocolValidationError, true);
    assert.equal(error.failure, NOVEL_PROTOCOL_FAILURE.invalidStoryEvent);
    assert.equal(error.field, "storyEventStep");
    assert.equal(error.message, "Novel protocol validation failed");
    return true;
  });
}
