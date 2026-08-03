import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FractionalOrderKeyFactory,
  MANUSCRIPT_ANCHOR_BOUNDARY,
  NovelDraftSessionService,
  STORY_ENTITY_CHANGE_CATEGORY,
  STORY_UNIT_CONFORMANCE_STATUS,
  canonicalNovelReadScope,
  captureCharacterId,
  captureLocationId,
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
  captureStoryOutlineId,
  captureStoryUnit,
  captureStoryUnitCharacterBinding,
  captureStoryUnitEntityChange,
  captureStoryUnitEntityChangeId,
  captureStoryUnitLocationBinding,
  captureStoryUnitRealization,
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

class DraftIdentityFactory { createDraftSessionId() { return "draft_evidence_application"; } }
class FixedRevisionFactory {
  constructor(value) { this.value = captureNovelRevision(value); }
  createRevision() { return this.value; }
}
class SequenceClock {
  offset = 0;
  now() {
    return captureNovelTimestamp(
      new Date(Date.UTC(2026, 7, 3, 13, 0, 0, this.offset++)).toISOString(),
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
  record(level, event, fields) { this.entries.push({ level, event, fields: { ...this.bindings, ...fields } }); }
}
function assertRedacted(entries, forbiddenValues) {
  const serialized = JSON.stringify(entries);
  for (const value of forbiddenValues) assert.equal(serialized.includes(value), false);
  for (const entry of entries) for (const key of Object.keys(entry.fields)) {
    assert.equal(["payload", "content", "text", "title", "prompt", "path", "message", "error", "stack", "cause"].includes(key), false);
  }
}

const root = await mkdtemp(join(tmpdir(), "novel-evidence-application-"));
const workspaceRoot = join(root, "workspace");
const logs = [];
const logger = new CollectingLogger(logs);
let canonicalStore;
let draftStore;
try {
  await mkdir(workspaceRoot, { recursive: true });
  const workspace = await new NodeWorkspaceStoreLocator({ storageRoot: join(root, "storage") }).resolve(workspaceRoot);
  const location = await new NodeNovelStoreLocator().resolve(workspace);
  canonicalStore = await SqliteNovelCanonicalStore.open({
    location,
    revisionFactory: new FixedRevisionFactory("revision_evidence_base"),
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
  }).startDraft("conversation-evidence-application");
  const application = createNodeNovelApplication({ location, novelId: canonical.novelId, clock, logger });
  const draftScope = draftNovelReadScope(session);
  const order = new FractionalOrderKeyFactory().initial();
  const characterId = captureCharacterId("character_evidence_application");
  const locationId = captureLocationId("location_evidence_application");
  const outlineId = captureStoryOutlineId("outline_evidence_application");
  const storyUnitId = captureStoryUnitId("story_unit_evidence_application");
  const publicationId = capturePublicationStructureId("publication_evidence_application");
  const volumeId = capturePublicationVolumeId("volume_evidence_application");
  const chapterId = capturePublicationChapterId("chapter_evidence_application");
  const manuscriptId = captureManuscriptId("manuscript_evidence_application");
  const blockId = captureManuscriptBlockId("block_evidence_application");
  const changeId = captureStoryUnitEntityChangeId("change_evidence_application");
  const forbiddenText = "FORBIDDEN_EVIDENCE_MANUSCRIPT";
  const forbiddenNote = "FORBIDDEN_EVIDENCE_NOTE";

  await application.characters.create(session, characterId, { name: "Protagonist", aliases: [] });
  await application.locations.create(session, locationId, { name: "Place", aliases: [] });
  await application.outline.createOutline(session, outlineId);
  await application.outline.createStoryUnit(session, captureStoryUnit({
    id: storyUnitId,
    outlineId,
    orderKey: order,
    title: "Leaf",
    planningStatus: "ready",
    realizationStatus: "in-progress",
  }));
  await application.publication.createPublication(session, publicationId);
  await application.publication.createVolume(session, capturePublicationVolume({
    id: volumeId, publicationId, orderKey: order, title: "Volume",
  }));
  await application.publication.createChapter(session, capturePublicationChapter({
    id: chapterId, publicationId, volumeId, orderKey: order, title: "Chapter",
  }));
  await application.manuscript.createManuscript(session, manuscriptId, publicationId);
  await application.manuscript.createBlock(session, captureParagraphBlock({
    id: blockId, manuscriptId, chapterId, orderKey: order, text: forbiddenText,
  }));

  const characterBinding = captureStoryUnitCharacterBinding({ storyUnitId, characterId, note: "Initial" });
  const locationBinding = captureStoryUnitLocationBinding({ storyUnitId, locationId });
  const change = captureStoryUnitEntityChange({
    id: changeId,
    storyUnitId,
    entityType: "character",
    entityId: characterId,
    category: STORY_ENTITY_CHANGE_CATEGORY.condition,
    summary: forbiddenNote,
    sourceEventIds: [],
  });
  const realization = captureStoryUnitRealization({
    storyUnitId,
    ranges: [{
      start: { blockId, boundary: MANUSCRIPT_ANCHOR_BOUNDARY.before },
      end: { blockId, boundary: MANUSCRIPT_ANCHOR_BOUNDARY.after },
    }],
    sourceRevision: session.baseRevision,
    validation: {
      status: STORY_UNIT_CONFORMANCE_STATUS.conforming,
      checkedNovelRevision: session.baseRevision,
      findings: [],
    },
  });
  await application.evidence.putCharacterBinding(session, characterBinding);
  await application.evidence.putLocationBinding(session, locationBinding);
  await application.evidence.putEntityChange(session, change);
  await application.evidence.putRealization(session, realization);

  const initialCharacter = (await application.evidenceQueries.listCharacterBindings(draftScope))[0];
  await application.evidence.putCharacterBinding(
    session,
    captureStoryUnitCharacterBinding({ ...characterBinding, note: forbiddenNote }),
    initialCharacter.recordDigest,
  );
  const locationBindingRead = (await application.evidenceQueries.listLocationBindings(draftScope))[0];
  await application.evidence.deleteLocationBinding(
    session, storyUnitId, locationId, locationBindingRead.recordDigest,
  );
  const entityChange = (await application.evidenceQueries.listEntityChanges(draftScope))[0];
  await application.evidence.deleteEntityChange(session, changeId, entityChange.recordDigest);

  assert.equal((await application.evidenceQueries.listCharacterBindings(draftScope))[0].value.note, forbiddenNote);
  assert.equal((await application.evidenceQueries.listLocationBindings(draftScope)).length, 0);
  assert.equal((await application.evidenceQueries.listEntityChanges(draftScope)).length, 0);
  assert.equal((await application.evidenceQueries.getRealization(draftScope, storyUnitId)).recordDigest.length, 64);
  const admission = await application.evidenceQueries.evaluateCompletion(draftScope, storyUnitId);
  assert.equal(admission.status, "admitted");
  assert.equal(admission.storyUnit.realizationStatus, "completed");
  assert.equal(await application.evidenceQueries.getRealization(canonicalNovelReadScope, storyUnitId), undefined);

  const changeSet = await application.changeSets.build(session);
  assert.equal(changeSet.operationCount, 16);
  await application.commits.commit(session, {
    commitId: captureNovelCommitId("commit_evidence_application"),
    resultRevision: captureNovelRevision("revision_evidence_committed"),
    committedAt: captureNovelTimestamp("2026-08-03T13:30:00.000Z"),
  });
  const restarted = createNodeNovelApplication({ location, novelId: canonical.novelId, clock, logger });
  assert.equal((await restarted.evidenceQueries.listCharacterBindings(canonicalNovelReadScope)).length, 1);
  assert.equal((await restarted.evidenceQueries.listRealizations(canonicalNovelReadScope)).length, 1);
  const staleAdmission = await restarted.evidenceQueries.evaluateCompletion(canonicalNovelReadScope, storyUnitId);
  assert.equal(staleAdmission.status, "rejected");
  assert.equal(staleAdmission.reason, "realization-revision-stale");
  assertRedacted(logs, [root, forbiddenText, forbiddenNote]);
  console.log("novel evidence application smoke passed");
} finally {
  await draftStore?.close();
  await canonicalStore?.close();
  await rm(root, { recursive: true, force: true });
}
