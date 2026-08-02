import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  NovelChangeReviewShell,
  captureNovelChangeReviewView,
} from "../dist/index.js";

const digest = `sha256:${"a".repeat(64)}`;
const base = {
  target: {
    approvalRequestId: "approval-1",
    novelId: "novel-1",
    draftSessionId: "draft-1",
    baseRevision: "revision-4",
    changeSetDigest: digest,
    operationIds: ["operation-1", "operation-2"],
    domain: "outline",
  },
  title: "灯塔调查线调整",
  summary: "新增线索节点并移动高潮顺序。",
};
const captured = captureNovelChangeReviewView({ ...base, lifecycle: { state: "ready" } });
base.target.operationIds.push("mutated");
assert.equal(captured.target.operationIds.length, 2);
assert.ok(Object.isFrozen(captured));
assert.ok(Object.isFrozen(captured.target));
assert.ok(Object.isFrozen(captured.target.operationIds));
assert.throws(
  () =>
    captureNovelChangeReviewView({
      ...base,
      target: { ...base.target, operationIds: ["operation-1", "operation-1"] },
      lifecycle: { state: "ready" },
    }),
  /unique/,
);

for (const lifecycle of [
  { state: "loading" },
  { state: "ready" },
  { state: "pending-resolution" },
  { state: "resolved" },
  { state: "stale", code: "CHANGESET_STALE" },
  { state: "conflict", code: "REVISION_CONFLICT" },
  { state: "unavailable", code: "DRAFT_NOT_FOUND" },
  { state: "error", code: "QUERY_FAILED", retryable: true },
]) {
  const markup = renderToStaticMarkup(
    createElement(
      NovelChangeReviewShell,
      { view: { ...captured, lifecycle } },
      createElement("div", { "data-domain-review": true }, "Outline Diff"),
    ),
  );
  assert.match(markup, /灯塔调查线调整/);
  assert.match(markup, /操作数量/);
  assert.match(markup, /Outline Diff/);
  assert.match(markup, /Conversation InputEvent/);
  assert.doesNotMatch(markup, new RegExp(digest));
  assert.doesNotMatch(markup, /private-review-error/);
}
console.log("novel change review shell smoke passed");
