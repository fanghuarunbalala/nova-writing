import assert from "node:assert/strict";
import {
  FractionalOrderKeyFactory,
  NovelProtocolValidationError,
  STORY_UNIT_CONFORMANCE_STATUS,
  StoryOutlineTree,
  StoryUnitCompletionAdmissionValidator,
  StoryUnitConformanceEvaluator,
  captureNovelId,
  captureNovelRevision,
  captureParagraph,
  captureParagraphId,
  captureStoryOutline,
  captureStoryOutlineId,
  captureStoryUnit,
  captureStoryUnitConformanceResult,
  captureStoryUnitId,
} from "../dist/index.js";

const orders = new FractionalOrderKeyFactory();
const first = orders.initial();
const novelId = captureNovelId("novel_conformance");
const currentRevision = captureNovelRevision("revision_current");
const outline = captureStoryOutline({
  id: captureStoryOutlineId("outline_conformance"),
  novelId,
});
const root = captureStoryUnit({
  id: captureStoryUnitId("story_root"),
  outlineId: outline.id,
  orderKey: first,
  title: "Root",
  planningStatus: "ready",
  realizationStatus: "in-progress",
});
const leaf = captureStoryUnit({
  id: captureStoryUnitId("story_leaf"),
  outlineId: outline.id,
  parentId: root.id,
  orderKey: first,
  title: "Leaf",
  planningStatus: "ready",
  realizationStatus: "in-progress",
});
const tree = new StoryOutlineTree({ outline, units: [root, leaf] });
const paragraph = captureParagraph({
  id: captureParagraphId("paragraph_conformance"),
  storyUnitId: leaf.id,
  orderKey: first,
  text: "Written content",
});
const evaluator = new StoryUnitConformanceEvaluator();

const pending = evaluator.evaluate({
  paragraphs: [],
  hasAcceptedPlan: true,
  currentRevision,
});
assert.equal(pending.status, STORY_UNIT_CONFORMANCE_STATUS.pending);
const nonConforming = evaluator.evaluate({
  paragraphs: [paragraph],
  hasAcceptedPlan: false,
  currentRevision,
});
assert.equal(nonConforming.status, STORY_UNIT_CONFORMANCE_STATUS.nonConforming);
assert.equal(nonConforming.findings[0].paragraphIds.length, 0);
const conforming = evaluator.evaluate({
  paragraphs: [paragraph],
  hasAcceptedPlan: true,
  currentRevision,
});
assert.equal(conforming.status, STORY_UNIT_CONFORMANCE_STATUS.conforming);

const validator = new StoryUnitCompletionAdmissionValidator(tree);
const admitted = validator.evaluate({
  storyUnitId: leaf.id,
  paragraphs: [paragraph],
  hasAcceptedPlan: true,
  conformance: conforming,
  currentRevision,
});
assert.equal(admitted.status, "admitted");
assert.equal(admitted.storyUnit.realizationStatus, "completed");

assert.equal(
  validator.evaluate({
    storyUnitId: root.id,
    paragraphs: [paragraph],
    hasAcceptedPlan: true,
    conformance: conforming,
    currentRevision,
  }).status,
  "rejected",
);
assert.equal(
  validator.evaluate({
    storyUnitId: leaf.id,
    paragraphs: [],
    hasAcceptedPlan: true,
    conformance: pending,
    currentRevision,
  }).status,
  "rejected",
);
assert.equal(
  validator.evaluate({
    storyUnitId: leaf.id,
    paragraphs: [paragraph],
    hasAcceptedPlan: false,
    conformance: nonConforming,
    currentRevision,
  }).status,
  "rejected",
);
assert.equal(
  validator.evaluate({
    storyUnitId: leaf.id,
    paragraphs: [paragraph],
    hasAcceptedPlan: true,
    conformance: conforming,
    currentRevision: captureNovelRevision("revision_other"),
  }).status,
  "rejected",
);

const captured = captureStoryUnitConformanceResult({
  status: STORY_UNIT_CONFORMANCE_STATUS.conforming,
  checkedNovelRevision: currentRevision,
  findings: [],
});
assert.equal(captured.status, STORY_UNIT_CONFORMANCE_STATUS.conforming);
const capturedFinding = captureStoryUnitConformanceResult({
  status: STORY_UNIT_CONFORMANCE_STATUS.nonConforming,
  checkedNovelRevision: currentRevision,
  findings: [{
    type: "missing-event",
    severity: "error",
    note: "Missing event",
    paragraphIds: [paragraph.id],
  }],
});
assert.deepEqual(capturedFinding.findings[0].paragraphIds, [paragraph.id]);
assert.throws(
  () => captureStoryUnitConformanceResult({
    status: STORY_UNIT_CONFORMANCE_STATUS.conforming,
    checkedNovelRevision: currentRevision,
    findings: [{
      type: "missing-event",
      severity: "error",
      note: "Bad",
      paragraphIds: [],
    }],
  }),
  NovelProtocolValidationError,
);

console.log("novel conformance derivation smoke passed");
