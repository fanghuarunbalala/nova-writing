import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  FractionalOrderKeyFactory,
  NOVEL_LIFECYCLE_PUBLICATION_STATUS,
  NOVEL_PROJECTION_MODE,
  NOVEL_PROJECTION_TARGET_KIND,
  NOVEL_RECOVERY_PHASE,
  NovelDraftRecoveryService,
  NovelDraftSessionService,
  NovelProjectionPlanner,
  NovelRebaseRecoveryService,
  NovelRecoveryPhaseError,
  RandomNovelIdentityFactory,
  canonicalNovelReadScope,
  captureCharacter,
  captureCharacterId,
  captureManuscript,
  captureManuscriptBlockId,
  captureManuscriptId,
  captureNovelCommitId,
  captureNovelEntityVersion,
  captureNovelOperationId,
  captureNovelRevision,
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
  createManuscriptBlockSplitOperation,
} from "../dist/index.js";
import {
  NodeNovelOutboxRecoveryRunner,
  NodeNovelStoreLocator,
  NodeWorkspaceStoreLocator,
  SqliteNovelCanonicalStore,
  SqliteNovelDraftOperationStore,
  SqliteNovelDraftStore,
  SqliteNovelLifecycleRecordWriter,
  SqliteNovelProjectionSourceReader,
  SqliteNovelProjectionStore,
  SqliteNovelRebaseCandidateStore,
  SqliteNovelResolutionApplicationPlanStore,
  SqliteNovelResolvedRebaseCandidateStore,
  SqliteNovelSnapshotter,
  createNodeNovelApplication,
  createNodeNovelProjectionRecoveryStage,
  createNodeNovelRecoveryApplication,
  createSqliteNovelMutationContext,
} from "../dist/node/index.js";

class SequenceClock {
  offset = 0;
  now() {
    return captureNovelTimestamp(
      new Date(Date.UTC(2026, 7, 3, 16, 0, 0, this.offset++)).toISOString(),
    );
  }
}

class TogglePublisher {
  fail = true;
  sequence = 0;
  records = [];

  async publish(record) {
    if (this.fail) throw new Error("expected publisher failure");
    this.sequence += 1;
    this.records.push(record);
    return {
      status: NOVEL_LIFECYCLE_PUBLICATION_STATUS.recorded,
      conversationId: record.conversationId,
      eventId: record.eventId,
      sequence: this.sequence,
      recordedAt: captureNovelTimestamp(
        new Date(Date.UTC(2026, 7, 3, 18, 0, 0, this.sequence)).toISOString(),
      ),
    };
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

const root = await mkdtemp(join(tmpdir(), "node-novel-restart-recovery-"));
const workspaceRoot = join(root, "workspace");
let canonicalStore;
let draftStore;
let candidateStore;
let resolvedCandidateStore;

try {
  await mkdir(workspaceRoot, { recursive: true });
  const workspace = await new NodeWorkspaceStoreLocator({
    storageRoot: join(root, "storage"),
  }).resolve(workspaceRoot);
  const location = await new NodeNovelStoreLocator().resolve(workspace);
  const clock = new SequenceClock();
  canonicalStore = await SqliteNovelCanonicalStore.open({ location, clock });
  const metadata = await canonicalStore.getMetadata();
  const orderKeys = new FractionalOrderKeyFactory();
  const timestamp = clock.now();
  const character = captureCharacter({
    id: captureCharacterId("character_restart_recovery"),
    name: "Character",
    aliases: [],
    initialState: "before",
    entityVersion: captureNovelEntityVersion(1),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const outline = captureStoryOutline({
    id: captureStoryOutlineId("outline_restart_recovery"),
    novelId: metadata.novelId,
  });
  const storyUnit = captureStoryUnit({
    id: captureStoryUnitId("story_unit_restart_recovery"),
    outlineId: outline.id,
    orderKey: orderKeys.initial(),
    title: "Recovery unit",
    planningStatus: "ready",
    realizationStatus: "completed",
  });
  const publication = capturePublicationStructure({
    id: capturePublicationStructureId("publication_restart_recovery"),
    novelId: metadata.novelId,
  });
  const volume = capturePublicationVolume({
    id: capturePublicationVolumeId("volume_restart_recovery"),
    publicationId: publication.id,
    orderKey: orderKeys.initial(),
    title: "Volume",
  });
  const chapter = capturePublicationChapter({
    id: capturePublicationChapterId("chapter_restart_recovery"),
    publicationId: publication.id,
    volumeId: volume.id,
    orderKey: orderKeys.initial(),
    title: "Chapter",
  });
  const manuscript = captureManuscript({
    id: captureManuscriptId("manuscript_restart_recovery"),
    novelId: metadata.novelId,
    publicationId: publication.id,
  });
  const leftBlock = captureParagraphBlock({
    id: captureManuscriptBlockId("block_restart_left"),
    manuscriptId: manuscript.id,
    chapterId: chapter.id,
    orderKey: orderKeys.initial(),
    text: "Left and right",
  });
  const rightBlock = captureParagraphBlock({
    id: captureManuscriptBlockId("block_restart_right"),
    manuscriptId: manuscript.id,
    chapterId: chapter.id,
    orderKey: orderKeys.after(leftBlock.orderKey),
    text: "right",
  });
  const binding = captureStoryUnitCharacterBinding({
    storyUnitId: storyUnit.id,
    characterId: character.id,
  });
  const change = captureStoryUnitEntityChange({
    id: captureStoryUnitEntityChangeId("change_restart_recovery"),
    storyUnitId: storyUnit.id,
    entityType: "character",
    entityId: character.id,
    category: "condition",
    summary: "after",
    sourceEventIds: [],
  });
  const realization = captureStoryUnitRealization({
    storyUnitId: storyUnit.id,
    ranges: [{
      start: { blockId: leftBlock.id, boundary: "before" },
      end: { blockId: leftBlock.id, boundary: "after" },
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
      context.manuscript.insertBlock(leftBlock);
      context.projectionEvidence.putCharacterBinding(binding);
      context.projectionEvidence.putEntityChange(change);
      context.projectionEvidence.putRealization(realization);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  });

  draftStore = await SqliteNovelDraftStore.open({
    location,
    novelId: metadata.novelId,
  });
  const snapshotter = new SqliteNovelSnapshotter({
    location,
    novelId: metadata.novelId,
  });
  const draftSessions = new NovelDraftSessionService({
    canonicalStore,
    draftStore,
    snapshotter,
    identityFactory: new RandomNovelIdentityFactory(),
    clock,
  });
  const committingDraft = await draftSessions.startDraft(
    "conversation-restart-commit",
  );
  const activeDraft = await draftSessions.startDraft(
    "conversation-restart-active",
  );
  const application = createNodeNovelApplication({
    location,
    novelId: metadata.novelId,
    clock,
  });
  const committingDraftPath = join(
    location.stagingDir,
    committingDraft.ownerConversationId,
    committingDraft.id,
    "draft.sqlite",
  );
  const expectedTextDigest = withDatabase(
    committingDraftPath,
    (database) => createSqliteNovelMutationContext(database)
      .manuscript.getBlockDigest(leftBlock.id, "text"),
    true,
  );
  await application.mutations.execute(
    committingDraft,
    createManuscriptBlockSplitOperation({
      operationId: captureNovelOperationId("operation_restart_split"),
      blockId: leftBlock.id,
      expectedTextDigest,
      leftText: "Left",
      rightBlock,
    }),
  );
  const resultRevision = captureNovelRevision("revision_restart_committed");
  const committed = await application.commits.commit(committingDraft, {
    commitId: captureNovelCommitId("commit_restart_recovery"),
    resultRevision,
    committedAt: clock.now(),
  });
  assert.equal(committed.status, "committed");

  const readinessPolicy = {
    evaluateCharacter() { return []; },
    evaluateLocation() { return []; },
  };
  const sourceReader = new SqliteNovelProjectionSourceReader({
    location,
    novelId: metadata.novelId,
    scope: canonicalNovelReadScope,
  });
  const projectionContext = await sourceReader.readProjectionContext(
    metadata.novelId,
  );
  const projectionTarget = {
    kind: NOVEL_PROJECTION_TARGET_KIND.characterState,
    characterId: character.id,
    atStoryUnitId: storyUnit.id,
    mode: NOVEL_PROJECTION_MODE.planned,
  };
  const projection = new NovelProjectionPlanner(
    projectionContext.outline,
    projectionContext.source,
    projectionContext.ranges,
    readinessPolicy,
  ).projectCharacterState(projectionTarget);
  assert.notEqual(projection, undefined);
  const projectionStore = new SqliteNovelProjectionStore({
    location,
    novelId: metadata.novelId,
    scope: canonicalNovelReadScope,
    clock,
  });
  await projectionStore.putEntry({
    novelId: metadata.novelId,
    rebuildRevision: resultRevision,
    entry: { target: projectionTarget, projection },
  });

  candidateStore = await SqliteNovelRebaseCandidateStore.open({
    location,
    novelId: metadata.novelId,
  });
  resolvedCandidateStore = await SqliteNovelResolvedRebaseCandidateStore.open({
    location,
    novelId: metadata.novelId,
  });
  const operationStore = new SqliteNovelDraftOperationStore({
    location,
    novelId: metadata.novelId,
    contextFactory: createSqliteNovelMutationContext,
  });
  const rebaseRecovery = new NovelRebaseRecoveryService({
    draftStore,
    snapshotter,
    candidateStore,
    resolvedCandidateStore,
    operationStore,
    resolutionPlanStore: new SqliteNovelResolutionApplicationPlanStore({
      location,
      novelId: metadata.novelId,
    }),
  });
  const draftRecovery = new NovelDraftRecoveryService({
    canonicalStore,
    draftStore,
    snapshotter,
    rebaseCandidateStore: candidateStore,
    resolvedRebaseCandidateStore: resolvedCandidateStore,
    clock,
    lifecycleWriter: new SqliteNovelLifecycleRecordWriter(
      location,
      metadata.novelId,
    ),
  });
  const publisher = new TogglePublisher();
  const outboxRecovery = new NodeNovelOutboxRecoveryRunner({
    location,
    novelId: metadata.novelId,
    draftStore,
    candidateStore,
    resolvedCandidateStore,
    snapshotter,
    publisher,
  });
  const recoveryApplication = createNodeNovelRecoveryApplication({
    novelId: metadata.novelId,
    commitRecovery: application.commitRecovery,
    rebaseRecovery,
    draftRecovery,
    projectionRecovery: createNodeNovelProjectionRecoveryStage({
      location,
      novelId: metadata.novelId,
      scope: canonicalNovelReadScope,
      clock,
      readinessPolicy,
    }),
    outboxRecovery,
  });

  await assert.rejects(
    recoveryApplication.recover(),
    (error) =>
      error instanceof NovelRecoveryPhaseError &&
      error.phase === NOVEL_RECOVERY_PHASE.outbox,
  );
  assert.notEqual(
    await snapshotter.inspectDraftSnapshot(metadata.novelId, committingDraft.id),
    undefined,
  );

  publisher.fail = false;
  const recovered = await recoveryApplication.recover();
  assert.deepEqual(
    recovered.phases.map((phase) => phase.phase),
    [
      NOVEL_RECOVERY_PHASE.commit,
      NOVEL_RECOVERY_PHASE.rebase,
      NOVEL_RECOVERY_PHASE.draft,
      NOVEL_RECOVERY_PHASE.projection,
      NOVEL_RECOVERY_PHASE.outbox,
    ],
  );
  assert.equal(recovered.phases[0].inspectedCount, 1);
  assert.equal(recovered.phases[2].retainedCount >= 2, true);
  assert.equal(recovered.phases[3].repairedCount, 1);
  assert.equal(recovered.phases[4].publishedCount > 0, true);
  assert.equal(recovered.phases[4].removedCount, 1);
  assert.equal(
    await snapshotter.inspectDraftSnapshot(metadata.novelId, committingDraft.id),
    undefined,
  );
  assert.notEqual(
    await snapshotter.inspectDraftSnapshot(metadata.novelId, activeDraft.id),
    undefined,
  );
  assert.equal(
    (await projectionStore.getEntry(metadata.novelId, projectionTarget))
      ?.projection.sourceRevision,
    resultRevision,
  );
  assert.equal(new Set(publisher.records.map((record) => record.eventId)).size,
    publisher.records.length);

  const duplicate = await recoveryApplication.recover();
  assert.equal(duplicate.phases[4].publishedCount, 0);
  assert.equal(duplicate.phases[4].removedCount, 0);

  console.log("node novel restart recovery smoke passed");
} finally {
  await resolvedCandidateStore?.close();
  await candidateStore?.close();
  await draftStore?.close();
  await canonicalStore?.close();
  await rm(root, { recursive: true, force: true });
}
