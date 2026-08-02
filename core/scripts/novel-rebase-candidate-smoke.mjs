import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NovelDraftOperationWriter,
  NovelDraftRecoveryService,
  NovelDraftSessionService,
  NovelOperationExecutor,
  NovelOperationRegistry,
  NovelRebaseService,
  NovelRevisionConflictError,
  canonicalNovelReadScope,
  canonicalizeNovelConflictResolutionRecord,
  captureNovelConflictResolution,
  captureNovelConflictResolutionRecord,
  captureCharacterId,
  captureNovelCommitId,
  captureNovelDraftSessionId,
  captureNovelOperationId,
  captureNovelRevision,
  captureNovelTimestamp,
  draftNovelReadScope,
  createCharacterReplaceOperation,
  registerNovelEntityOperationHandlers,
} from "../dist/index.js";
import {
  NodeNovelStoreLocator,
  NodeSha256NovelConflictDigester,
  NodeSha256NovelOperationDigester,
  NodeWorkspaceStoreLocator,
  SqliteNovelCanonicalStore,
  SqliteNovelConflictStore,
  SqliteNovelDraftOperationStore,
  SqliteNovelDraftStore,
  SqliteNovelRebaseCandidateStore,
  SqliteNovelSnapshotter,
  createNodeNovelEntityApplication,
  createSqliteNovelEntityMutationContext,
  digestNovelConflictText,
} from "../dist/node/index.js";

class DraftIdentityFactory {
  constructor(ids) {
    this.ids = [...ids];
  }
  createDraftSessionId() {
    return captureNovelDraftSessionId(this.ids.shift());
  }
}

class RebaseIdentityFactory extends DraftIdentityFactory {
  constructor(draftIds, conflictIds) {
    super(draftIds);
    this.conflictIds = [...conflictIds];
  }
  createConflictId() {
    return this.conflictIds.shift();
  }
}

class OperationIdentityFactory {
  constructor() {
    this.sequence = 0;
  }
  createOperationId() {
    this.sequence += 1;
    return captureNovelOperationId(`rebase_operation_${this.sequence}`);
  }
}

class SequenceClock {
  constructor() {
    this.offset = 0;
  }
  now() {
    return captureNovelTimestamp(
      new Date(Date.UTC(2026, 7, 2, 16, 0, 0, this.offset++)).toISOString(),
    );
  }
}

class CollectingLogger {
  constructor(entries = [], bindings = {}) {
    this.entries = entries;
    this.bindings = bindings;
  }
  debug(event, fields = {}) { this.record("debug", event, fields); }
  info(event, fields = {}) { this.record("info", event, fields); }
  warn(event, fields = {}) { this.record("warn", event, fields); }
  error(event, fields = {}) { this.record("error", event, fields); }
  child(bindings) {
    return new CollectingLogger(this.entries, {
      ...this.bindings,
      ...bindings,
    });
  }
  record(level, event, fields) {
    this.entries.push({
      level,
      event,
      fields: { ...this.bindings, ...fields },
    });
  }
}

function candidatePath(location, session) {
  return join(
    location.stagingDir,
    session.ownerConversationId,
    session.id,
  );
}

function assertRedacted(entries, forbiddenValues) {
  const serialized = JSON.stringify(entries);
  for (const value of forbiddenValues) {
    assert.equal(serialized.includes(value), false);
  }
  for (const entry of entries) {
    for (const field of [
      "path",
      "sql",
      "payload",
      "content",
      "text",
      "message",
      "stack",
      "cause",
    ]) {
      assert.equal(Object.hasOwn(entry.fields, field), false);
    }
  }
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const root = await mkdtemp(join(tmpdir(), "novel-rebase-candidate-"));
const workspaceRoot = join(root, "workspace");
const logs = [];
const logger = new CollectingLogger(logs);
const clock = new SequenceClock();
let canonicalStore;
let draftStore;
let candidateStore;

try {
  await mkdir(workspaceRoot, { recursive: true });
  const workspace = await new NodeWorkspaceStoreLocator({
    storageRoot: join(root, "storage"),
  }).resolve(workspaceRoot);
  const location = await new NodeNovelStoreLocator().resolve(workspace);
  canonicalStore = await SqliteNovelCanonicalStore.open({
    location,
    revisionFactory: {
      createRevision: () => captureNovelRevision("revision_rebase_base"),
    },
    clock,
    logger,
  });
  const canonical = await canonicalStore.getMetadata();
  draftStore = await SqliteNovelDraftStore.open({
    location,
    novelId: canonical.novelId,
    logger,
  });
  candidateStore = await SqliteNovelRebaseCandidateStore.open({
    location,
    novelId: canonical.novelId,
    logger,
  });
  const snapshotter = new SqliteNovelSnapshotter({
    location,
    novelId: canonical.novelId,
    logger,
  });
  const drafts = new NovelDraftSessionService({
    canonicalStore,
    draftStore,
    snapshotter,
    identityFactory: new DraftIdentityFactory([
      "draft_rebase_committer",
      "draft_rebase_source",
      "draft_rebase_conflict_source",
      "draft_rebase_conflict_committer",
      "draft_rebase_deleted_source",
      "draft_rebase_deleted_committer",
    ]),
    clock,
    logger,
  });
  const committingDraft = await drafts.startDraft("conversation-rebase-a");
  const sourceDraft = await drafts.startDraft("conversation-rebase-b");
  const operationIdentityFactory = new OperationIdentityFactory();
  const application = createNodeNovelEntityApplication({
    location,
    novelId: canonical.novelId,
    identityFactory: operationIdentityFactory,
    clock,
    logger,
  });
  const characterId = captureCharacterId("character_rebase_shared");
  const sourceLocationName = "FORBIDDEN_REBASE_SOURCE_LOCATION";
  const canonicalCharacterName = "FORBIDDEN_REBASE_CANONICAL_CHARACTER";
  await application.characters.create(committingDraft, characterId, {
    name: canonicalCharacterName,
    aliases: [],
  });
  await application.locations.create(
    sourceDraft,
    "location_rebase_source",
    {
      name: sourceLocationName,
      aliases: [],
    },
  );
  await application.commits.commit(committingDraft, {
    commitId: captureNovelCommitId("commit_rebase_a"),
    resultRevision: captureNovelRevision("revision_rebase_a"),
    committedAt: clock.now(),
  });
  await assert.rejects(
    application.commits.commit(sourceDraft, {
      commitId: captureNovelCommitId("commit_rebase_stale"),
      resultRevision: captureNovelRevision("revision_rebase_stale"),
      committedAt: clock.now(),
    }),
    NovelRevisionConflictError,
  );

  const operationRegistry = new NovelOperationRegistry();
  registerNovelEntityOperationHandlers(operationRegistry);
  const operationExecutor = new NovelOperationExecutor(operationRegistry);
  const operationStore = new SqliteNovelDraftOperationStore({
    location,
    novelId: canonical.novelId,
    contextFactory: createSqliteNovelEntityMutationContext,
    logger,
  });
  const operationDigester = new NodeSha256NovelOperationDigester();
  const conflictDigester = new NodeSha256NovelConflictDigester({
    location,
    novelId: canonical.novelId,
  });
  const conflictStore = new SqliteNovelConflictStore({
    location,
    novelId: canonical.novelId,
    logger,
  });
  const operationWriter = new NovelDraftOperationWriter({
    store: operationStore,
    executor: operationExecutor,
    digester: operationDigester,
    clock,
    logger,
  });
  const rebase = new NovelRebaseService({
    canonicalStore,
    draftStore,
    snapshotter,
    candidateStore,
    conflictStore,
    conflictDigester,
    operationStore,
    writer: operationWriter,
    executor: operationExecutor,
    operationDigester,
    identityFactory: new RebaseIdentityFactory(
      [
        "draft_rebase_candidate",
        "draft_rebase_conflicted_candidate",
        "draft_rebase_deleted_candidate",
      ],
      ["conflict_rebase_modified", "conflict_rebase_deleted"],
    ),
    clock,
    logger,
  });

  const preparation = await rebase.prepareCandidate(sourceDraft.id);
  const candidate = preparation.candidate;
  assert.deepEqual(preparation.conflicts, []);
  assert.equal(candidate.sourceDraftSessionId, sourceDraft.id);
  assert.equal(candidate.sourceBaseRevision, sourceDraft.baseRevision);
  assert.equal(candidate.session.baseRevision, "revision_rebase_a");
  assert.equal(candidate.operationCount, 1);
  assert.equal(candidate.lastOperationSequence, 1);
  assert.equal(
    (
      await application.characterQueries.get(
        draftNovelReadScope(candidate.session),
        characterId,
      )
    ).name,
    canonicalCharacterName,
  );
  assert.equal(
    (
      await application.locationQueries.get(
        draftNovelReadScope(candidate.session),
        "location_rebase_source",
      )
    ).name,
    sourceLocationName,
  );
  assert.equal(
    await application.characterQueries.get(
      draftNovelReadScope(sourceDraft),
      characterId,
    ),
    undefined,
  );
  const candidateSnapshot = await snapshotter.inspectDraftSnapshot(
    canonical.novelId,
    candidate.session.id,
  );
  assert.equal(candidateSnapshot.kind, "rebase-candidate");
  assert.equal(candidateSnapshot.sourceDraftSessionId, sourceDraft.id);

  const conflictSource = await drafts.startDraft("conversation-rebase-c");
  const conflictCommitter = await drafts.startDraft("conversation-rebase-d");
  const conflictSourceName = "FORBIDDEN_REBASE_CONFLICT_SOURCE";
  const conflictCanonicalName = "FORBIDDEN_REBASE_CONFLICT_CANONICAL";
  await application.characters.replace(
    conflictSource,
    characterId,
    1,
    { name: conflictSourceName, aliases: [] },
  );
  await application.characters.replace(
    conflictCommitter,
    characterId,
    1,
    { name: conflictCanonicalName, aliases: [] },
  );
  await application.commits.commit(conflictCommitter, {
    commitId: captureNovelCommitId("commit_rebase_conflict"),
    resultRevision: captureNovelRevision("revision_rebase_conflict"),
    committedAt: clock.now(),
  });
  const conflicted = await rebase.prepareCandidate(conflictSource.id);
  assert.equal(conflicted.conflicts.length, 1);
  assert.equal(conflicted.conflicts[0].conflict.kind, "field-modified");
  assert.equal(conflicted.conflicts[0].conflict.fieldPath, "profile");
  assert.match(conflicted.conflicts[0].conflict.baseDigest, /^sha256:[0-9a-f]{64}$/);
  assert.match(conflicted.conflicts[0].conflict.canonicalDigest, /^sha256:[0-9a-f]{64}$/);
  assert.match(conflicted.conflicts[0].conflict.draftDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(
    await exists(
      candidatePath(location, conflicted.candidate.session),
    ),
    true,
  );
  assert.deepEqual(
    await candidateStore.getCandidate(
      canonical.novelId,
      conflicted.candidate.session.id,
    ),
    conflicted.candidate,
  );
  assert.deepEqual(
    await conflictStore.listConflicts(conflicted.candidate.session),
    conflicted.conflicts,
  );
  const keepCanonicalResolution = captureNovelConflictResolutionRecord({
    resolutionVersion: 1,
    draftSessionId: conflicted.candidate.session.id,
    conflictId: conflicted.conflicts[0].conflict.id,
    resolution: captureNovelConflictResolution({
      strategy: "keep-canonical",
    }),
    resolvedAt: clock.now(),
  });
  const keepCanonicalDigest = digestNovelConflictText(
    canonicalizeNovelConflictResolutionRecord(keepCanonicalResolution),
  );
  assert.equal(
    await conflictStore.resolveConflict(
      conflicted.candidate.session,
      keepCanonicalResolution,
      keepCanonicalDigest,
    ),
    "resolved",
  );
  assert.equal(
    await conflictStore.resolveConflict(
      conflicted.candidate.session,
      keepCanonicalResolution,
      keepCanonicalDigest,
    ),
    "duplicate",
  );
  assert.deepEqual(
    await conflictStore.listResolutions(conflicted.candidate.session),
    [keepCanonicalResolution],
  );
  assert.deepEqual(
    await conflictStore.listConflicts(conflicted.candidate.session),
    [],
  );
  assert.deepEqual(
    captureNovelConflictResolution({ strategy: "keep-draft" }),
    { strategy: "keep-draft" },
  );
  assert.deepEqual(
    captureNovelConflictResolution({ strategy: "drop-operation" }),
    { strategy: "drop-operation" },
  );
  const manualReplacement = createCharacterReplaceOperation({
    operationId: captureNovelOperationId("operation_manual_resolution"),
    id: characterId,
    expectedEntityVersion: 2,
    profile: { name: "FORBIDDEN_MANUAL_RESOLUTION", aliases: [] },
    timestamp: clock.now(),
  });
  assert.deepEqual(
    captureNovelConflictResolution({
      strategy: "manual",
      replacement: manualReplacement,
    }),
    { strategy: "manual", replacement: manualReplacement },
  );
  assert.equal(
    (
      await application.characterQueries.get(
        draftNovelReadScope(conflictSource),
        characterId,
      )
    ).name,
    conflictSourceName,
  );
  assert.equal(
    (
      await application.characterQueries.get(
        canonicalNovelReadScope,
        characterId,
      )
    ).name,
    conflictCanonicalName,
  );

  const deletedSource = await drafts.startDraft("conversation-rebase-e");
  const deletedCommitter = await drafts.startDraft("conversation-rebase-f");
  await application.characters.replace(
    deletedSource,
    characterId,
    2,
    { name: "FORBIDDEN_REBASE_DELETED_SOURCE", aliases: [] },
  );
  await application.characters.delete(deletedCommitter, characterId, 2);
  await application.commits.commit(deletedCommitter, {
    commitId: captureNovelCommitId("commit_rebase_deleted"),
    resultRevision: captureNovelRevision("revision_rebase_deleted"),
    committedAt: clock.now(),
  });
  const deletedConflict = await rebase.prepareCandidate(deletedSource.id);
  assert.equal(deletedConflict.conflicts.length, 1);
  assert.equal(deletedConflict.conflicts[0].conflict.kind, "entity-deleted");
  assert.equal(deletedConflict.conflicts[0].conflict.fieldPath, undefined);
  assert.deepEqual(
    await conflictStore.listConflicts(deletedConflict.candidate.session),
    deletedConflict.conflicts,
  );

  await candidateStore.close();
  candidateStore = await SqliteNovelRebaseCandidateStore.open({
    location,
    novelId: canonical.novelId,
    logger,
  });
  assert.deepEqual(
    await candidateStore.getCandidate(canonical.novelId, candidate.session.id),
    candidate,
  );
  assert.deepEqual(
    await candidateStore.getCandidate(
      canonical.novelId,
      conflicted.candidate.session.id,
    ),
    conflicted.candidate,
  );
  assert.deepEqual(
    await conflictStore.listResolutions(conflicted.candidate.session),
    [keepCanonicalResolution],
  );

  const interruptedName =
    ".draft_interrupted.00000000-0000-4000-8000-000000000000.snapshot-tmp";
  const ownerDir = join(location.stagingDir, "conversation-rebase-b");
  const interruptedPath = join(ownerDir, interruptedName);
  const unknownPath = join(ownerDir, ".unknown-diagnostics");
  await mkdir(interruptedPath, { recursive: true });
  await mkdir(unknownPath, { recursive: true });
  const recovery = new NovelDraftRecoveryService({
    canonicalStore,
    draftStore,
    snapshotter,
    rebaseCandidateStore: candidateStore,
    clock,
    logger,
  });
  const recovered = await recovery.recoverDraftSessions();
  assert.equal(
    recovered.removedOrphanSnapshotIds.includes(candidate.session.id),
    false,
  );
  assert.equal(await exists(interruptedPath), false);
  assert.equal(await exists(unknownPath), true);
  assert.equal(await exists(candidatePath(location, candidate.session)), true);

  assertRedacted(logs, [
    root,
    sourceLocationName,
    canonicalCharacterName,
    conflictSourceName,
    conflictCanonicalName,
    "FORBIDDEN_REBASE_DELETED_SOURCE",
    "FORBIDDEN_MANUAL_RESOLUTION",
  ]);
} finally {
  await candidateStore?.close();
  await draftStore?.close();
  await canonicalStore?.close();
  await rm(root, { recursive: true, force: true });
}

console.log("novel rebase candidate smoke passed");
