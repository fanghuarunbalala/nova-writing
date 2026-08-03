import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  FractionalOrderKeyFactory,
  NOVEL_PROJECTION_MODE,
  NOVEL_PROJECTION_TARGET_KIND,
  NovelDraftSessionService,
  NovelProjectionPlanner,
  canonicalNovelReadScope,
  captureCharacter,
  captureCharacterId,
  captureManuscript,
  captureManuscriptBlockId,
  captureManuscriptId,
  captureNovelEntityVersion,
  captureNovelTimestamp,
  captureParagraphBlock,
  capturePublicationChapter,
  capturePublicationChapterId,
  capturePublicationStructure,
  capturePublicationStructureId,
  capturePublicationVolume,
  capturePublicationVolumeId,
  captureStoryOutline,
  captureStoryOutlineId,
  captureStoryUnit,
  captureStoryUnitCharacterBinding,
  captureStoryUnitEntityChange,
  captureStoryUnitEntityChangeId,
  captureStoryUnitId,
  captureStoryUnitRealization,
  draftNovelReadScope,
} from "../dist/index.js";
import {
  NodeNovelStoreLocator,
  NodeWorkspaceStoreLocator,
  SqliteNovelCanonicalStore,
  SqliteNovelDraftStore,
  SqliteNovelProjectionSourceReader,
  SqliteNovelProjectionStore,
  SqliteNovelSnapshotter,
  createNodeNovelProjectionRecoveryStage,
  createSqliteNovelMutationContext,
} from "../dist/node/index.js";

class Clock {
  offset = 0;
  now() {
    return captureNovelTimestamp(
      new Date(Date.UTC(2026, 7, 3, 14, 0, 0, this.offset++)).toISOString(),
    );
  }
}

class IdentityFactory {
  createDraftSessionId() {
    return "draft_projection_evidence";
  }
}

function withDatabase(path, callback, readOnly = false) {
  const database = new DatabaseSync(path, { readOnly });
  try {
    database.exec("PRAGMA foreign_keys = ON");
    return callback(database);
  } finally {
    database.close();
  }
}

const root = await mkdtemp(join(tmpdir(), "novel-projection-evidence-"));
const workspaceRoot = join(root, "workspace");
let canonicalStore;
let draftStore;

try {
  await mkdir(workspaceRoot, { recursive: true });
  const workspace = await new NodeWorkspaceStoreLocator({
    storageRoot: join(root, "storage"),
  }).resolve(workspaceRoot);
  const location = await new NodeNovelStoreLocator().resolve(workspace);
  canonicalStore = await SqliteNovelCanonicalStore.open({ location });
  const metadata = await canonicalStore.getMetadata();
  const orderKey = new FractionalOrderKeyFactory().initial();
  const timestamp = captureNovelTimestamp("2026-08-03T14:00:00.000Z");
  const character = captureCharacter({
    id: captureCharacterId("character_evidence"),
    name: "Character",
    aliases: [],
    entityVersion: captureNovelEntityVersion(1),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const outline = captureStoryOutline({
    id: captureStoryOutlineId("outline_evidence"),
    novelId: metadata.novelId,
  });
  const storyUnit = captureStoryUnit({
    id: captureStoryUnitId("story_unit_evidence"),
    outlineId: outline.id,
    orderKey,
    title: "Evidence",
    planningStatus: "outlined",
    realizationStatus: "completed",
  });
  const publication = capturePublicationStructure({
    id: capturePublicationStructureId("publication_evidence"),
    novelId: metadata.novelId,
  });
  const volume = capturePublicationVolume({
    id: capturePublicationVolumeId("volume_evidence"),
    publicationId: publication.id,
    orderKey,
    title: "Volume",
  });
  const chapter = capturePublicationChapter({
    id: capturePublicationChapterId("chapter_evidence"),
    publicationId: publication.id,
    volumeId: volume.id,
    orderKey,
    title: "Chapter",
  });
  const manuscript = captureManuscript({
    id: captureManuscriptId("manuscript_evidence"),
    novelId: metadata.novelId,
    publicationId: publication.id,
  });
  const block = captureParagraphBlock({
    id: captureManuscriptBlockId("block_evidence"),
    manuscriptId: manuscript.id,
    chapterId: chapter.id,
    orderKey,
    text: "Evidence text",
  });
  const binding = captureStoryUnitCharacterBinding({
    storyUnitId: storyUnit.id,
    characterId: character.id,
    note: "planned",
  });
  const change = captureStoryUnitEntityChange({
    id: captureStoryUnitEntityChangeId("change_evidence"),
    storyUnitId: storyUnit.id,
    entityType: "character",
    entityId: character.id,
    category: "condition",
    summary: "changed",
    sourceEventIds: [],
  });
  const realization = captureStoryUnitRealization({
    storyUnitId: storyUnit.id,
    ranges: [{
      start: { blockId: block.id, boundary: "before" },
      end: { blockId: block.id, boundary: "after" },
    }],
    sourceRevision: metadata.currentRevision,
    validation: {
      status: "conforming",
      checkedNovelRevision: metadata.currentRevision,
      findings: [],
    },
  });

  withDatabase(location.canonicalDatabasePath, (database) => {
    database.exec("BEGIN IMMEDIATE");
    try {
      const context = createSqliteNovelMutationContext(database);
      context.characters.insert(character);
      context.outline.insertOutline(outline);
      context.outline.insertStoryUnit(storyUnit);
      context.publication.insertPublication(publication);
      context.publication.insertVolume(volume);
      context.publication.insertChapter(chapter);
      context.manuscript.insertManuscript(manuscript);
      context.manuscript.insertBlock(block);
      context.projectionEvidence.putCharacterBinding(binding);
      context.projectionEvidence.putEntityChange(change);
      context.projectionEvidence.putRealization(realization);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  });

  withDatabase(location.canonicalDatabasePath, (database) => {
    const evidence = createSqliteNovelMutationContext(database).projectionEvidence;
    assert.deepEqual(evidence.listCharacterBindings(), [binding]);
    assert.deepEqual(evidence.listEntityChanges(), [change]);
    assert.deepEqual(evidence.listRealizations(), [realization]);
  }, true);

  const readinessPolicy = {
    evaluateCharacter() { return []; },
    evaluateLocation() { return []; },
  };
  const canonicalReader = new SqliteNovelProjectionSourceReader({
    location,
    novelId: metadata.novelId,
    scope: canonicalNovelReadScope,
  });
  const canonicalContext = await canonicalReader.readProjectionContext(
    metadata.novelId,
  );
  assert.equal(canonicalContext.outline.getUnit(storyUnit.id)?.id, storyUnit.id);
  assert.deepEqual(canonicalContext.source.characterBindings, [binding]);
  assert.deepEqual(canonicalContext.source.entityChanges, [change]);
  assert.deepEqual(canonicalContext.source.realizations, [realization]);
  const target = {
    kind: NOVEL_PROJECTION_TARGET_KIND.characterState,
    characterId: character.id,
    atStoryUnitId: storyUnit.id,
    mode: NOVEL_PROJECTION_MODE.confirmed,
  };
  const initialProjection = new NovelProjectionPlanner(
    canonicalContext.outline,
    canonicalContext.source,
    canonicalContext.ranges,
    readinessPolicy,
  ).projectCharacterState(target);
  assert.notEqual(initialProjection, undefined);
  const clock = new Clock();
  const projectionStore = new SqliteNovelProjectionStore({
    location,
    novelId: metadata.novelId,
    scope: canonicalNovelReadScope,
    clock,
  });
  await projectionStore.putEntry({
    novelId: metadata.novelId,
    rebuildRevision: metadata.currentRevision,
    entry: { target, projection: initialProjection },
  });
  const recovery = await createNodeNovelProjectionRecoveryStage({
    location,
    novelId: metadata.novelId,
    scope: canonicalNovelReadScope,
    clock,
    readinessPolicy,
  }).recover(metadata.novelId);
  assert.equal(recovery.repairedCount, 1);
  assert.equal(
    (await projectionStore.getEntry(metadata.novelId, target))
      ?.projection.sourceRevision,
    metadata.currentRevision,
  );

  draftStore = await SqliteNovelDraftStore.open({ location, novelId: metadata.novelId });
  const session = await new NovelDraftSessionService({
    canonicalStore,
    draftStore,
    snapshotter: new SqliteNovelSnapshotter({ location, novelId: metadata.novelId }),
    identityFactory: new IdentityFactory(),
    clock,
  }).startDraft("conversation-projection-evidence");
  const draftPath = join(
    location.stagingDir,
    session.ownerConversationId,
    session.id,
    "draft.sqlite",
  );
  withDatabase(draftPath, (database) => {
    const evidence = createSqliteNovelMutationContext(database).projectionEvidence;
    evidence.putCharacterBinding({ ...binding, note: "draft" });
    assert.equal(evidence.listCharacterBindings()[0].note, "draft");
  });
  const draftContext = await new SqliteNovelProjectionSourceReader({
    location,
    novelId: metadata.novelId,
    scope: draftNovelReadScope(session),
  }).readProjectionContext(metadata.novelId);
  assert.equal(draftContext.source.currentRevision, session.baseRevision);
  assert.equal(draftContext.source.characterBindings[0].note, "draft");
  withDatabase(location.canonicalDatabasePath, (database) => {
    assert.equal(
      createSqliteNovelMutationContext(database)
        .projectionEvidence.listCharacterBindings()[0].note,
      "planned",
    );
  }, true);

  withDatabase(draftPath, (database) => {
    database.prepare(
      "UPDATE novel_story_unit_realizations SET realization_digest = ? WHERE story_unit_id = ?",
    ).run("0".repeat(64), storyUnit.id);
    assert.throws(() => createSqliteNovelMutationContext(database)
      .projectionEvidence.listRealizations());
  });

  console.log("novel projection evidence SQLite smoke passed");
} finally {
  await draftStore?.close();
  await canonicalStore?.close();
  await rm(root, { recursive: true, force: true });
}
