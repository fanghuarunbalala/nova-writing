import assert from "node:assert/strict";
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
  captureOrderKey,
  captureStoryTimeDescription,
  compareStoryTimeDescriptions,
} from "../dist/index.js";

const morning = captureStoryTimeDescription({
  description: "the following morning",
  timelineOrderKey: captureOrderKey("4000"),
});
const flashback = captureStoryTimeDescription({
  description: "ten years earlier",
  timelineOrderKey: captureOrderKey("2000"),
});
const simultaneous = captureStoryTimeDescription({
  description: "elsewhere at the same moment",
  timelineOrderKey: morning.timelineOrderKey,
});
const unplaced = captureStoryTimeDescription({
  description: "after the investigation begins",
});

assert.equal(Object.isFrozen(morning), true);
assert.equal(compareStoryTimeDescriptions(flashback, morning), -1);
assert.equal(compareStoryTimeDescriptions(morning, flashback), 1);
assert.equal(compareStoryTimeDescriptions(morning, simultaneous), 0);
assert.equal(compareStoryTimeDescriptions(unplaced, morning), undefined);
assert.equal(compareStoryTimeDescriptions(morning, unplaced), undefined);
assert.equal(compareStoryTimeDescriptions(unplaced, unplaced), undefined);

for (const invalid of [
  undefined,
  null,
  {},
  { description: "" },
  { description: " leading" },
  { description: "trailing " },
  { description: "invalid\u0000time" },
  { description: "valid", calendarTimestamp: "2026-08-03T00:00:00.000Z" },
]) {
  assert.throws(
    () => captureStoryTimeDescription(invalid),
    (error) => {
      assert.equal(error instanceof NovelProtocolValidationError, true);
      assert.equal(error.failure, NOVEL_PROTOCOL_FAILURE.invalidStoryTime);
      assert.equal(error.field, "storyTimeDescription");
      assert.equal(error.message, "Novel protocol validation failed");
      return true;
    },
  );
}

assert.throws(
  () =>
    captureStoryTimeDescription({
      description: "valid",
      timelineOrderKey: "invalid",
    }),
  (error) => {
    assert.equal(error instanceof NovelProtocolValidationError, true);
    assert.equal(error.failure, NOVEL_PROTOCOL_FAILURE.invalidOrderKey);
    assert.equal(error.field, "orderKey");
    return true;
  },
);

console.log("novel story time smoke passed");
