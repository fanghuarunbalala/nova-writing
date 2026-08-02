import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CharacterChangeReviewer,
  LocationChangeReviewer,
  captureEntityFieldReviewView,
} from "../dist/index.js";

const mutable = createView();
const captured = captureEntityFieldReviewView(mutable);
mutable.fields[0].after.text = "mutated";
assert.equal(captured.fields[0].after.text, "调查记者");
assert.ok(Object.isFrozen(captured));
assert.ok(Object.isFrozen(captured.fields));
assert.ok(Object.isFrozen(captured.evidence[0].sourceStoryUnitIds));
assert.throws(
  () =>
    captureEntityFieldReviewView({
      ...createView(),
      fields: [
        { fieldId: "name", label: "名称", kind: "added", before: { kind: "text", text: "old" } },
      ],
    }),
  /inconsistent/,
);

for (const [domain, Component, heading] of [
  ["character", CharacterChangeReviewer, "人物变更"],
  ["location", LocationChangeReviewer, "地点变更"],
]) {
  const markup = renderToStaticMarkup(createElement(Component, { view: captured }));
  assert.match(markup, new RegExp(`data-entity-domain="${domain}"`));
  assert.match(markup, new RegExp(heading));
  assert.match(markup, /data-diff-kind="added"/);
  assert.match(markup, /data-diff-kind="removed"/);
  assert.match(markup, /data-diff-kind="modified"/);
  assert.match(markup, /data-value-tone="added"/);
  assert.match(markup, /data-value-tone="removed"/);
  assert.match(markup, /修复型投影视图|可重建的投影视图/);
  assert.match(markup, /来源 StoryUnit：2/);
  assert.doesNotMatch(markup, /story-unit-1|story-unit-2/);
  assert.doesNotMatch(markup, /private-evidence-payload/);
}
console.log("entity change reviewer smoke passed");

function createView() {
  return {
    entityId: "character-1",
    entityName: "林舟",
    fields: [
      {
        fieldId: "role",
        label: "身份",
        kind: "added",
        after: { kind: "text", text: "调查记者" },
      },
      {
        fieldId: "alias",
        label: "旧称呼",
        kind: "removed",
        before: { kind: "list", items: ["小林"] },
      },
      {
        fieldId: "summary",
        label: "人物摘要",
        kind: "modified",
        before: { kind: "text", text: "谨慎的记者" },
        after: { kind: "text", text: "执着追查灯塔真相的记者" },
      },
      {
        fieldId: "notes",
        label: "作者备注",
        kind: "unchanged",
        before: { kind: "text", text: "避免过早揭示身世" },
      },
    ],
    evidence: [
      {
        evidenceId: "evidence-1",
        mode: "planned",
        title: "白塔港阶段状态",
        summary: "预计在调查后产生信任危机。",
        sourceStoryUnitIds: ["story-unit-1", "story-unit-2"],
        privatePayload: "private-evidence-payload",
      },
    ],
  };
}
