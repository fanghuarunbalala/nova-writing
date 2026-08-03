import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FractionalOrderKeyFactory,
  MANUSCRIPT_ANCHOR_BOUNDARY,
  NovelDraftSessionService,
  canonicalNovelReadScope,
  captureManuscriptBlockId,
  captureManuscriptId,
  captureNovelCommitId,
  captureNovelRevision,
  captureNovelTimestamp,
  captureParagraphBlock,
  capturePublicationChapter,
  capturePublicationChapterId,
  capturePublicationStructureId,
  capturePublicationVolume,
  capturePublicationVolumeId,
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

class DraftIdentityFactory { createDraftSessionId() { return "draft_manuscript_application"; } }
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

const root = await mkdtemp(join(tmpdir(), "novel-manuscript-application-"));
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
    revisionFactory: new FixedRevisionFactory("revision_manuscript_base"),
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
  }).startDraft("conversation-manuscript-application");
  const application = createNodeNovelApplication({ location, novelId: canonical.novelId, clock, logger });
  const draftScope = draftNovelReadScope(session);
  const orders = new FractionalOrderKeyFactory();
  const first = orders.initial();
  const second = orders.after(first);
  const third = orders.after(second);
  const publicationId = capturePublicationStructureId("publication_manuscript_application");
  const volumeId = capturePublicationVolumeId("volume_manuscript_application");
  const chapterOneId = capturePublicationChapterId("chapter_manuscript_one");
  const chapterTwoId = capturePublicationChapterId("chapter_manuscript_two");
  const manuscriptId = captureManuscriptId("manuscript_application");
  const leftBlockId = captureManuscriptBlockId("block_manuscript_left");
  const rightBlockId = captureManuscriptBlockId("block_manuscript_right");
  const movableBlockId = captureManuscriptBlockId("block_manuscript_movable");
  const mergeLeftBlockId = captureManuscriptBlockId("block_manuscript_merge_left");
  const mergeRightBlockId = captureManuscriptBlockId("block_manuscript_merge_right");
  const forbiddenText = "FORBIDDEN_MANUSCRIPT_TEXT";

  await application.publication.createPublication(session, publicationId);
  await application.publication.createVolume(session, capturePublicationVolume({
    id: volumeId, publicationId, orderKey: first, title: "Volume",
  }));
  await application.publication.createChapter(session, capturePublicationChapter({
    id: chapterOneId, publicationId, volumeId, orderKey: first, title: "Chapter One",
  }));
  await application.publication.createChapter(session, capturePublicationChapter({
    id: chapterTwoId, publicationId, volumeId, orderKey: second, title: "Chapter Two",
  }));
  await application.manuscript.createManuscript(session, manuscriptId, publicationId);
  await application.manuscript.createBlock(session, captureParagraphBlock({
    id: leftBlockId, manuscriptId, chapterId: chapterOneId, orderKey: first, text: "Draft text",
  }));
  let left = await application.manuscriptQueries.getBlock(draftScope, leftBlockId);
  await application.manuscript.replaceBlockText(
    session, leftBlockId, left.textDigest, forbiddenText,
  );
  left = await application.manuscriptQueries.getBlock(draftScope, leftBlockId);
  await application.manuscript.splitBlock(session, {
    blockId: leftBlockId,
    expectedTextDigest: left.textDigest,
    leftText: "Left",
    rightBlock: captureParagraphBlock({
      id: rightBlockId, manuscriptId, chapterId: chapterOneId, orderKey: second, text: "Right",
    }),
  });
  await application.manuscript.createBlock(session, captureParagraphBlock({
    id: mergeLeftBlockId, manuscriptId, chapterId: chapterTwoId, orderKey: first, text: "Merge left",
  }));
  await application.manuscript.createBlock(session, captureParagraphBlock({
    id: mergeRightBlockId, manuscriptId, chapterId: chapterTwoId, orderKey: second, text: "Merge right",
  }));
  const mergeLeft = await application.manuscriptQueries.getBlock(draftScope, mergeLeftBlockId);
  const mergeRight = await application.manuscriptQueries.getBlock(draftScope, mergeRightBlockId);
  await application.manuscript.mergeBlocks(session, {
    leftBlockId: mergeLeftBlockId,
    rightBlockId: mergeRightBlockId,
    expectedLeftTextDigest: mergeLeft.textDigest,
    expectedRightTextDigest: mergeRight.textDigest,
    expectedLeftChapterDigest: mergeLeft.chapterDigest,
    expectedRightChapterDigest: mergeRight.chapterDigest,
    expectedLeftOrderDigest: mergeLeft.orderDigest,
    expectedRightOrderDigest: mergeRight.orderDigest,
    text: forbiddenText,
  });
  await application.manuscript.createBlock(session, captureParagraphBlock({
    id: movableBlockId, manuscriptId, chapterId: chapterOneId, orderKey: third, text: "Movable",
  }));
  let movable = await application.manuscriptQueries.getBlock(draftScope, movableBlockId);
  await application.manuscript.moveBlock(session, {
    blockId: movableBlockId,
    expectedChapterDigest: movable.chapterDigest,
    expectedOrderDigest: movable.orderDigest,
    chapterId: chapterTwoId,
    orderKey: second,
  });
  movable = await application.manuscriptQueries.getBlock(draftScope, movableBlockId);
  await application.manuscript.deleteBlock(session, {
    blockId: movableBlockId,
    expectedTextDigest: movable.textDigest,
    expectedChapterDigest: movable.chapterDigest,
    expectedOrderDigest: movable.orderDigest,
  });
  await application.manuscript.repairAnchor(
    session,
    { blockId: movableBlockId, boundary: MANUSCRIPT_ANCHOR_BOUNDARY.before },
    { blockId: leftBlockId, boundary: MANUSCRIPT_ANCHOR_BOUNDARY.before },
  );

  const draftCatalog = await application.manuscriptQueries.getCatalog(draftScope);
  assert.deepEqual(draftCatalog.snapshot.blocks.map((block) => block.id), [
    leftBlockId,
    rightBlockId,
    mergeLeftBlockId,
  ]);
  assert.equal(draftCatalog.snapshot.blocks[2].text, forbiddenText);
  assert.equal(draftCatalog.blockDigests[leftBlockId].textDigest.length, 64);
  const repairs = await application.manuscriptQueries.getRepairs(draftScope);
  assert.equal(repairs.tombstones.length, 2);
  assert.equal(repairs.redirects.length, 4);
  assert.equal(await application.manuscriptQueries.getCatalog(canonicalNovelReadScope), undefined);

  const changeSet = await application.changeSets.build(session);
  assert.equal(changeSet.operationCount, 15);
  await application.commits.commit(session, {
    commitId: captureNovelCommitId("commit_manuscript_application"),
    resultRevision: captureNovelRevision("revision_manuscript_committed"),
    committedAt: captureNovelTimestamp("2026-08-03T12:30:00.000Z"),
  });
  const restarted = createNodeNovelApplication({ location, novelId: canonical.novelId, clock, logger });
  assert.equal(
    (await restarted.manuscriptQueries.getBlock(
      canonicalNovelReadScope,
      mergeLeftBlockId,
    )).block.text,
    forbiddenText,
  );
  assert.equal((await restarted.manuscriptQueries.getRepairs(canonicalNovelReadScope)).redirects.length, 4);
  assertRedacted(logs, [root, forbiddenText]);
  console.log("novel manuscript application smoke passed");
} finally {
  await draftStore?.close();
  await canonicalStore?.close();
  await rm(root, { recursive: true, force: true });
}
