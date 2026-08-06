import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FractionalOrderKeyFactory,
  NovelDraftSessionService,
  canonicalNovelReadScope,
  captureNovelCommitId,
  captureNovelRevision,
  captureNovelTimestamp,
  captureParagraph,
  captureParagraphId,
  captureStoryOutlineId,
  captureStoryUnit,
  captureStoryUnitId,
  draftNovelReadScope,
} from "../dist/index.js";
import {
  NodeNovelStoreLocator,
  NodeWorkspaceStoreLocator,
  SqliteNovelCanonicalStore,
  SqliteNovelDraftStore,
  SqliteNovelSnapshotter,
  createNodeNovelApplication,
} from "../dist/node/index.js";

class DraftIdentityFactory { createDraftSessionId() { return "draft_paragraph_application"; } }
class FixedRevisionFactory {
  constructor(value) { this.value = captureNovelRevision(value); }
  createRevision() { return this.value; }
}
class SequenceClock {
  offset = 0;
  now() {
    return captureNovelTimestamp(
      new Date(Date.UTC(2026, 7, 3, 12, 0, 0, this.offset++)).toISOString(),
    );
  }
}
class CollectingLogger {
  constructor(entries = [], bindings = {}) { this.entries = entries; this.bindings = bindings; }
  debug(event, fields = {}) { this.record("debug", event, fields); }
  info(event, fields = {}) { this.record("info", event, fields); }
  warn(event, fields = {}) { this.record("warn", event, fields); }
  error(event, fields = {}) { this.record("error", event, fields); }
  child(bindings) { return new CollectingLogger(this.entries, { ...this.bindings, ...bindings }); }
  record(level, event, fields) {
    this.entries.push({ level, event, fields: { ...this.bindings, ...fields } });
  }
}

function assertRedacted(entries, forbiddenValues) {
  const serialized = JSON.stringify(entries);
  for (const value of forbiddenValues) assert.equal(serialized.includes(value), false);
  for (const entry of entries) {
    for (const key of Object.keys(entry.fields)) {
      assert.equal([
        "payload", "content", "text", "title", "prompt", "path", "message",
        "error", "stack", "cause",
      ].includes(key), false);
    }
  }
}

const root = await mkdtemp(join(tmpdir(), "novel-paragraph-application-"));
const workspaceRoot = join(root, "workspace");
const logs = [];
const logger = new CollectingLogger(logs);
let canonicalStore;
let draftStore;

try {
  await mkdir(workspaceRoot, { recursive: true });
  const workspace = await new NodeWorkspaceStoreLocator({
    storageRoot: join(root, "storage"),
  }).resolve(workspaceRoot);
  const location = await new NodeNovelStoreLocator().resolve(workspace);
  canonicalStore = await SqliteNovelCanonicalStore.open({
    location,
    revisionFactory: new FixedRevisionFactory("revision_paragraph_base"),
    logger,
  });
  const canonical = await canonicalStore.getMetadata();
  draftStore = await SqliteNovelDraftStore.open({ location, novelId: canonical.novelId, logger });
  const clock = new SequenceClock();
  const session = await new NovelDraftSessionService({
    canonicalStore,
    draftStore,
    snapshotter: new SqliteNovelSnapshotter({ location, novelId: canonical.novelId, logger }),
    identityFactory: new DraftIdentityFactory(),
    clock,
    logger,
  }).startDraft("conversation-paragraph-application");
  const application = createNodeNovelApplication({ location, novelId: canonical.novelId, clock, logger });
  const draftScope = draftNovelReadScope(session);
  const orders = new FractionalOrderKeyFactory();
  const first = orders.initial();
  const second = orders.after(first);
  const third = orders.after(second);
  const outlineId = captureStoryOutlineId("outline_paragraph_application");
  const storyUnitId = captureStoryUnitId("story_unit_paragraph_application");
  const leftParagraphId = captureParagraphId("paragraph_application_left");
  const rightParagraphId = captureParagraphId("paragraph_application_right");
  const deletedParagraphId = captureParagraphId("paragraph_application_deleted");
  const forbiddenText = "FORBIDDEN_PARAGRAPH_TEXT";

  await application.outline.createOutline(session, outlineId);
  await application.outline.createStoryUnit(session, captureStoryUnit({
    id: storyUnitId,
    outlineId,
    orderKey: first,
    title: "Leaf",
    planningStatus: "ready",
    realizationStatus: "in-progress",
  }));
  await application.paragraphs.createParagraph(session, captureParagraph({
    id: leftParagraphId,
    storyUnitId,
    orderKey: first,
    text: "Draft text",
  }));
  let left = await application.paragraphQueries.getParagraph(draftScope, leftParagraphId);
  await application.paragraphs.replaceText(
    session, leftParagraphId, left.textDigest, forbiddenText,
  );
  left = await application.paragraphQueries.getParagraph(draftScope, leftParagraphId);
  await application.paragraphs.createParagraph(session, captureParagraph({
    id: rightParagraphId,
    storyUnitId,
    orderKey: second,
    text: "Right",
  }));
  await application.paragraphs.createParagraph(session, captureParagraph({
    id: deletedParagraphId,
    storyUnitId,
    orderKey: third,
    text: "Delete me",
  }));
  const deleted = await application.paragraphQueries.getParagraph(draftScope, deletedParagraphId);
  await application.paragraphs.deleteParagraph(
    session,
    deletedParagraphId,
    deleted.textDigest,
    deleted.orderDigest,
    deleted.storyUnitDigest,
  );
  const reordered = await application.paragraphQueries.getParagraph(draftScope, rightParagraphId);
  await application.paragraphs.replaceOrder(
    session, rightParagraphId, reordered.orderDigest, third,
  );

  const catalog = await application.paragraphQueries.getCatalog(draftScope);
  assert.deepEqual(catalog.snapshot.paragraphs.map((paragraph) => paragraph.id), [
    leftParagraphId,
    rightParagraphId,
  ]);
  assert.equal(catalog.snapshot.paragraphs[0].text, forbiddenText);
  assert.equal(catalog.paragraphDigests[leftParagraphId].textDigest.length, 64);
  const storyUnitParagraphs = await application.paragraphQueries.listParagraphsByStoryUnit(
    draftScope,
    storyUnitId,
  );
  assert.equal(storyUnitParagraphs.length, 2);
  assert.deepEqual(
    (await application.paragraphQueries.getCatalog(canonicalNovelReadScope)).snapshot.paragraphs,
    [],
  );

  const changeSet = await application.changeSets.build(session);
  assert.equal(changeSet.operationCount, 8);
  await application.commits.commit(session, {
    commitId: captureNovelCommitId("commit_paragraph_application"),
    resultRevision: captureNovelRevision("revision_paragraph_committed"),
    committedAt: captureNovelTimestamp("2026-08-03T12:30:00.000Z"),
  });
  const restarted = createNodeNovelApplication({ location, novelId: canonical.novelId, clock, logger });
  assert.equal(
    (await restarted.paragraphQueries.getParagraph(
      canonicalNovelReadScope,
      leftParagraphId,
    )).paragraph.text,
    forbiddenText,
  );
  assertRedacted(logs, [root, forbiddenText]);
  console.log("novel paragraph application smoke passed");
} finally {
  await draftStore?.close();
  await canonicalStore?.close();
  await rm(root, { recursive: true, force: true });
}
