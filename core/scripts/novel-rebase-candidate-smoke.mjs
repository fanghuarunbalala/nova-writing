import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  NovelDraftOperationWriter,
  NovelDraftRecoveryService,
  NovelDraftSessionService,
  NovelApprovalRequiredError,
  NovelEntityKeepDraftStrategy,
  NovelInvariantViolationError,
  NovelOperationExecutor,
  NovelOperationRegistry,
  NovelProtocolValidationError,
  NovelRebaseService,
  NovelResolutionApplicationPlanIdentityConflictError,
  NovelResolutionApplicationPlanBuilder,
  NovelResolvedRebasePromotionService,
  NovelResolvedRebaseService,
  NovelRevisionConflictError,
  canonicalNovelReadScope,
  canonicalizeNovelConflictResolutionRecord,
  captureCharacter,
  captureLocation,
  captureNovelConflict,
  captureNovelConflictRecord,
  captureNovelConflictResolution,
  captureNovelConflictResolutionRecord,
  captureCharacterId,
  captureNovelCommitId,
  captureNovelDraftSessionId,
  captureNovelEntityVersion,
  captureLocationId,
  captureNovelOperationId,
  captureNovelResolutionApplicationPlan,
  captureNovelResolvedRebaseCandidate,
  captureNovelRevision,
  captureNovelTimestamp,
  draftNovelReadScope,
  createCharacterCreateOperation,
  createCharacterDeleteOperation,
  createCharacterReplaceOperation,
  createLocationReplaceOperation,
  registerNovelEntityOperationHandlers,
} from "../dist/index.js";
import {
  NodeNovelStoreLocator,
  NodeSha256NovelConflictDigester,
  NodeSha256NovelOperationDigester,
  NodeSha256NovelResolutionApplicationPlanDigester,
  NodeWorkspaceStoreLocator,
  SqliteNovelCanonicalStore,
  SqliteNovelConflictStore,
  SqliteNovelDraftOperationStore,
  SqliteNovelDraftStore,
  SqliteNovelRebaseCandidateStore,
  SqliteNovelResolutionApplicationPlanStore,
  SqliteNovelResolvedRebaseCandidateStore,
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
      "draft_rebase_plan_source",
      "draft_rebase_plan_committer",
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
        "draft_rebase_plan_candidate",
      ],
      [
        "conflict_rebase_modified",
        "conflict_rebase_deleted",
        "conflict_plan_keep_canonical",
        "conflict_plan_drop",
        "conflict_plan_manual",
        "conflict_plan_keep_draft",
      ],
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

  const keepDraftStrategy = new NovelEntityKeepDraftStrategy({
    identityFactory: operationIdentityFactory,
    clock,
    logger,
  });
  const conflictSourceSequence = await operationStore.readOperationSequence(
    conflictSource,
  );
  const conflictCurrentCharacter = await application.characterQueries.get(
    draftNovelReadScope(conflicted.candidate.session),
    characterId,
  );
  assert.notEqual(conflictCurrentCharacter, undefined);
  const modifiedPlan = keepDraftStrategy.plan({
    sourceOperation: conflictSourceSequence.operations[0].operation,
    conflict: conflicted.conflicts[0],
    currentEntity: conflictCurrentCharacter,
  });
  assert.equal(modifiedPlan.action, "apply-replacement");
  assert.equal(modifiedPlan.operation.type, "character.replace");
  assert.equal(
    modifiedPlan.operation.expected[0].expectedEntityVersion,
    conflictCurrentCharacter.entityVersion,
  );

  const deletedSourceSequence = await operationStore.readOperationSequence(
    deletedSource,
  );
  const deletedPlan = keepDraftStrategy.plan({
    sourceOperation: deletedSourceSequence.operations[0].operation,
    conflict: deletedConflict.conflicts[0],
    currentEntity: undefined,
  });
  assert.equal(deletedPlan.action, "apply-replacement");
  assert.equal(deletedPlan.operation.type, "character.create");

  const deleteOperation = createCharacterDeleteOperation({
    operationId: captureNovelOperationId("operation_keep_draft_delete"),
    id: characterId,
    expectedEntityVersion: captureNovelEntityVersion(1),
  });
  const syntheticDigest = `sha256:${"1".repeat(64)}`;
  const deletedDeleteConflict = captureNovelConflictRecord({
    conflict: captureNovelConflict({
      conflictVersion: 1,
      id: "conflict_keep_draft_delete_missing",
      draftSessionId: deletedConflict.candidate.session.id,
      operationId: deleteOperation.operationId,
      sourceOperationSequence: 1,
      status: "unresolved",
      kind: "entity-deleted",
      entityType: "character",
      entityId: characterId,
      baseDigest: syntheticDigest,
      canonicalDigest: syntheticDigest,
      draftDigest: syntheticDigest,
      createdAt: clock.now(),
    }),
    digest: syntheticDigest,
  });
  assert.deepEqual(
    keepDraftStrategy.plan({
      sourceOperation: deleteOperation,
      conflict: deletedDeleteConflict,
      currentEntity: undefined,
    }),
    { action: "skip" },
  );
  const modifiedDeleteConflict = captureNovelConflictRecord({
    conflict: captureNovelConflict({
      ...deletedDeleteConflict.conflict,
      id: "conflict_keep_draft_delete_modified",
      kind: "field-modified",
    }),
    digest: syntheticDigest,
  });
  const deletePlan = keepDraftStrategy.plan({
    sourceOperation: deleteOperation,
    conflict: modifiedDeleteConflict,
    currentEntity: conflictCurrentCharacter,
  });
  assert.equal(deletePlan.action, "apply-replacement");
  assert.equal(deletePlan.operation.type, "character.delete");
  assert.equal(
    deletePlan.operation.expected[0].expectedEntityVersion,
    conflictCurrentCharacter.entityVersion,
  );

  const sameProfileOperation = createCharacterCreateOperation({
    operationId: captureNovelOperationId("operation_keep_draft_same_profile"),
    id: characterId,
    profile: { name: conflictSourceName, aliases: [] },
    timestamp: clock.now(),
  });
  const sameProfileConflict = captureNovelConflictRecord({
    conflict: captureNovelConflict({
      ...conflicted.conflicts[0].conflict,
      id: "conflict_keep_draft_same_profile",
      operationId: sameProfileOperation.operationId,
      kind: "entity-created",
    }),
    digest: syntheticDigest,
  });
  assert.deepEqual(
    keepDraftStrategy.plan({
      sourceOperation: sameProfileOperation,
      conflict: sameProfileConflict,
      currentEntity: captureCharacter({
        id: characterId,
        name: conflictSourceName,
        aliases: [],
        entityVersion: captureNovelEntityVersion(7),
        createdAt: clock.now(),
        updatedAt: clock.now(),
      }),
    }),
    { action: "skip" },
  );

  const locationId = captureLocationId("location_keep_draft_strategy");
  const locationReplaceOperation = createLocationReplaceOperation({
    operationId: captureNovelOperationId("operation_keep_draft_location"),
    id: locationId,
    expectedEntityVersion: captureNovelEntityVersion(1),
    profile: { name: "FORBIDDEN_LOCATION_DRAFT", aliases: [] },
    timestamp: clock.now(),
  });
  const locationConflict = captureNovelConflictRecord({
    conflict: captureNovelConflict({
      conflictVersion: 1,
      id: "conflict_keep_draft_location",
      draftSessionId: deletedConflict.candidate.session.id,
      operationId: locationReplaceOperation.operationId,
      sourceOperationSequence: 1,
      status: "unresolved",
      kind: "field-modified",
      entityType: "location",
      entityId: locationId,
      fieldPath: "profile",
      baseDigest: syntheticDigest,
      canonicalDigest: syntheticDigest,
      draftDigest: syntheticDigest,
      createdAt: clock.now(),
    }),
    digest: syntheticDigest,
  });
  const locationPlan = keepDraftStrategy.plan({
    sourceOperation: locationReplaceOperation,
    conflict: locationConflict,
    currentEntity: captureLocation({
      id: locationId,
      name: "FORBIDDEN_LOCATION_CANONICAL",
      aliases: [],
      entityVersion: captureNovelEntityVersion(3),
      createdAt: clock.now(),
      updatedAt: clock.now(),
    }),
  });
  assert.equal(locationPlan.action, "apply-replacement");
  assert.equal(locationPlan.operation.type, "location.replace");
  assert.equal(
    locationPlan.operation.expected[0].expectedEntityVersion,
    3,
  );

  const planSource = await drafts.startDraft("conversation-rebase-plan-source");
  const planCommitter = await drafts.startDraft(
    "conversation-rebase-plan-committer",
  );
  const planCharacterIds = [
    captureCharacterId("character_plan_keep_canonical"),
    captureCharacterId("character_plan_drop"),
    captureCharacterId("character_plan_manual"),
    captureCharacterId("character_plan_keep_draft"),
  ];
  await application.locations.create(planSource, "location_plan_original", {
    name: "FORBIDDEN_PLAN_ORIGINAL_LOCATION",
    aliases: [],
  });
  for (const [index, id] of planCharacterIds.entries()) {
    await application.characters.create(planSource, id, {
      name: `FORBIDDEN_PLAN_SOURCE_${index}`,
      aliases: [],
    });
    await application.characters.create(planCommitter, id, {
      name: `FORBIDDEN_PLAN_CANONICAL_${index}`,
      aliases: [],
    });
  }
  await application.commits.commit(planCommitter, {
    commitId: captureNovelCommitId("commit_rebase_plan"),
    resultRevision: captureNovelRevision("revision_rebase_plan"),
    committedAt: clock.now(),
  });
  const planCandidate = await rebase.prepareCandidate(planSource.id);
  assert.equal(planCandidate.conflicts.length, 4);

  const planStore = new SqliteNovelResolutionApplicationPlanStore({
    location,
    novelId: canonical.novelId,
    logger,
  });
  const planDigester = new NodeSha256NovelResolutionApplicationPlanDigester();
  const missingResolutionBuilder = new NovelResolutionApplicationPlanBuilder({
    draftStore,
    operationStore,
    conflictStore,
    keepDraftPlanner: {
      async planKeepDraft() {
        throw new Error("unexpected keep-draft planning");
      },
    },
    operationDigester,
    planDigester,
    planStore,
    clock,
    logger,
  });
  await assert.rejects(
    missingResolutionBuilder.buildAndSave(planCandidate.candidate),
    NovelInvariantViolationError,
  );

  const manualPlanReplacement = createCharacterReplaceOperation({
    operationId: captureNovelOperationId("operation_plan_manual"),
    id: planCharacterIds[2],
    expectedEntityVersion: 1,
    profile: { name: "FORBIDDEN_PLAN_MANUAL", aliases: [] },
    timestamp: clock.now(),
  });
  const strategies = [
    { strategy: "keep-canonical" },
    { strategy: "drop-operation" },
    { strategy: "manual", replacement: manualPlanReplacement },
    { strategy: "keep-draft" },
  ];
  for (const [index, conflict] of planCandidate.conflicts.entries()) {
    const resolution = captureNovelConflictResolutionRecord({
      resolutionVersion: 1,
      draftSessionId: planCandidate.candidate.session.id,
      conflictId: conflict.conflict.id,
      resolution: captureNovelConflictResolution(strategies[index]),
      resolvedAt: clock.now(),
    });
    await conflictStore.resolveConflict(
      planCandidate.candidate.session,
      resolution,
      digestNovelConflictText(
        canonicalizeNovelConflictResolutionRecord(resolution),
      ),
    );
  }

  const duplicateIdentityBuilder = new NovelResolutionApplicationPlanBuilder({
    draftStore,
    operationStore,
    conflictStore,
    keepDraftPlanner: {
      async planKeepDraft() {
        return { action: "apply-replacement", operation: manualPlanReplacement };
      },
    },
    operationDigester,
    planDigester,
    planStore,
    clock,
    logger,
  });
  await assert.rejects(
    duplicateIdentityBuilder.buildAndSave(planCandidate.candidate),
    NovelProtocolValidationError,
  );

  let keepDraftPlanningCount = 0;
  const planBuilder = new NovelResolutionApplicationPlanBuilder({
    draftStore,
    operationStore,
    conflictStore,
    keepDraftPlanner: {
      async planKeepDraft(input) {
        keepDraftPlanningCount += 1;
        const currentEntity = input.conflict.conflict.entityType === "character"
          ? await application.characterQueries.get(
              draftNovelReadScope(input.candidate.session),
              input.conflict.conflict.entityId,
            )
          : await application.locationQueries.get(
              draftNovelReadScope(input.candidate.session),
              input.conflict.conflict.entityId,
            );
        return keepDraftStrategy.plan({
          sourceOperation: input.sourceEntry.operation,
          conflict: input.conflict,
          currentEntity,
        });
      },
    },
    operationDigester,
    planDigester,
    planStore,
    clock,
    logger,
  });
  const planned = await planBuilder.buildAndSave(planCandidate.candidate);
  assert.equal(planned.status, "recorded");
  assert.equal(planned.plan.sourceOperationCount, 5);
  assert.equal(planned.plan.effectiveOperationCount, 3);
  assert.deepEqual(
    planned.plan.entries.map((entry) => [entry.sourceSequence, entry.action,
      entry.action === "apply-original" ? undefined : entry.strategy]),
    [
      [1, "apply-original", undefined],
      [2, "skip", "keep-canonical"],
      [3, "skip", "drop-operation"],
      [4, "apply-replacement", "manual"],
      [5, "apply-replacement", "keep-draft"],
    ],
  );
  assert.equal(
    (await planBuilder.buildAndSave(planCandidate.candidate)).status,
    "duplicate",
  );
  assert.equal(keepDraftPlanningCount, 1);
  assert.equal(
    await planStore.savePlan(planCandidate.candidate.session, planned.plan),
    "duplicate",
  );
  await assert.rejects(
    planStore.savePlan(
      planCandidate.candidate.session,
      captureNovelResolutionApplicationPlan({
        ...planned.plan,
        createdAt: clock.now(),
      }),
    ),
    NovelResolutionApplicationPlanIdentityConflictError,
  );
  const restartedPlanStore = new SqliteNovelResolutionApplicationPlanStore({
    location,
    novelId: canonical.novelId,
    logger,
  });
  assert.deepEqual(
    await restartedPlanStore.getPlan(planCandidate.candidate.session),
    planned.plan,
  );
  let resolvedCandidateStore = await SqliteNovelResolvedRebaseCandidateStore.open({
    location,
    novelId: canonical.novelId,
    logger,
  });
  const resolvedPreparedAt = clock.now();
  const resolvedCandidate = captureNovelResolvedRebaseCandidate({
    sourceDraftSessionId: planCandidate.candidate.sourceDraftSessionId,
    conflictedCandidateDraftSessionId: planCandidate.candidate.session.id,
    resolutionPlanDigest: planned.plan.digest,
    session: {
      id: captureNovelDraftSessionId("draft_rebase_plan_resolved"),
      novelId: canonical.novelId,
      ownerConversationId: planCandidate.candidate.session.ownerConversationId,
      baseRevision: planCandidate.candidate.session.baseRevision,
      status: "rebasing",
      createdAt: resolvedPreparedAt,
      updatedAt: resolvedPreparedAt,
    },
    operationCount: planned.plan.effectiveOperationCount,
    lastOperationSequence: planned.plan.effectiveOperationCount,
    preparedAt: resolvedPreparedAt,
  });
  await resolvedCandidateStore.createResolvedCandidate(resolvedCandidate);
  await assert.rejects(
    resolvedCandidateStore.createResolvedCandidate({
      ...resolvedCandidate,
      session: {
        ...resolvedCandidate.session,
        id: captureNovelDraftSessionId("draft_rebase_plan_resolved_other"),
      },
    }),
  );
  await resolvedCandidateStore.close();
  resolvedCandidateStore = await SqliteNovelResolvedRebaseCandidateStore.open({
    location,
    novelId: canonical.novelId,
    logger,
  });
  assert.deepEqual(
    await resolvedCandidateStore.getResolvedCandidate(
      canonical.novelId,
      resolvedCandidate.session.id,
    ),
    resolvedCandidate,
  );
  assert.deepEqual(
    await resolvedCandidateStore.listResolvedCandidates(canonical.novelId),
    [resolvedCandidate],
  );
  await resolvedCandidateStore.removeResolvedCandidate(
    canonical.novelId,
    resolvedCandidate.session.id,
  );
  const resolvedRebase = new NovelResolvedRebaseService({
    canonicalStore,
    snapshotter,
    operationStore,
    executor: operationExecutor,
    planStore: restartedPlanStore,
    resolvedCandidateStore,
    identityFactory: new DraftIdentityFactory([
      "draft_rebase_plan_resolved_replayed",
    ]),
    clock,
    logger,
  });
  const replayedResolvedCandidate = await resolvedRebase
    .prepareResolvedCandidate(planCandidate.candidate);
  assert.equal(
    replayedResolvedCandidate.operationCount,
    planned.plan.effectiveOperationCount,
  );
  assert.deepEqual(
    await resolvedCandidateStore.getResolvedCandidate(
      canonical.novelId,
      replayedResolvedCandidate.session.id,
    ),
    replayedResolvedCandidate,
  );
  assert.notEqual(
    await application.locationQueries.get(
      draftNovelReadScope(replayedResolvedCandidate.session),
      "location_plan_original",
    ),
    undefined,
  );
  assert.equal(
    (
      await application.characterQueries.get(
        draftNovelReadScope(replayedResolvedCandidate.session),
        planCharacterIds[2],
      )
    ).name,
    "FORBIDDEN_PLAN_MANUAL",
  );
  assert.equal(
    await exists(candidatePath(location, planCandidate.candidate.session)),
    true,
  );
  const promotionService = new NovelResolvedRebasePromotionService({
    store: resolvedCandidateStore,
    clock,
    logger,
  });
  const promoted = await promotionService.promote(replayedResolvedCandidate);
  assert.equal(promoted.status, "promoted");
  assert.equal(promoted.promotion.session.status, "active");
  assert.equal(
    (await draftStore.getDraftSession(canonical.novelId, planSource.id)).status,
    "conflicted",
  );
  assert.equal(
    (
      await draftStore.getActiveDraftSession(
        canonical.novelId,
        planSource.ownerConversationId,
      )
    ).id,
    replayedResolvedCandidate.session.id,
  );
  await resolvedCandidateStore.close();
  resolvedCandidateStore = await SqliteNovelResolvedRebaseCandidateStore.open({
    location,
    novelId: canonical.novelId,
    logger,
  });
  const duplicatePromotion = await new NovelResolvedRebasePromotionService({
    store: resolvedCandidateStore,
    clock,
    logger,
  }).promote(replayedResolvedCandidate);
  assert.equal(duplicatePromotion.status, "duplicate");
  assert.deepEqual(
    duplicatePromotion.promotion,
    promoted.promotion,
  );
  const approvedApplication = createNodeNovelEntityApplication({
    location,
    novelId: canonical.novelId,
    identityFactory: operationIdentityFactory,
    clock,
    logger,
    requireApproval: true,
  });
  const resolvedCommitOptions = {
    commitId: captureNovelCommitId("commit_rebase_plan_resolved"),
    resultRevision: captureNovelRevision("revision_rebase_plan_resolved"),
    committedAt: clock.now(),
  };
  await assert.rejects(
    approvedApplication.commits.commit(
      promoted.promotion.session,
      resolvedCommitOptions,
    ),
    NovelApprovalRequiredError,
  );
  const promotedChangeSet = await approvedApplication.changeSets.build(
    promoted.promotion.session,
  );
  await assert.rejects(
    approvedApplication.approvals.verify(promotedChangeSet),
    NovelApprovalRequiredError,
  );
  const granted = await approvedApplication.approvals.grant(promotedChangeSet);
  assert.equal(granted.status, "recorded");
  assert.equal(
    granted.approval.draftSessionId,
    replayedResolvedCandidate.session.id,
  );
  const resolvedCommit = await approvedApplication.commits.commit(
    promoted.promotion.session,
    resolvedCommitOptions,
  );
  assert.equal(resolvedCommit.status, "committed");
  assert.equal(
    (await canonicalStore.getMetadata()).currentRevision,
    resolvedCommitOptions.resultRevision,
  );
  assert.equal(
    (
      await draftStore.getDraftSession(
        canonical.novelId,
        replayedResolvedCandidate.session.id,
      )
    ).status,
    "committed",
  );
  const restartedCanonicalStore = await SqliteNovelCanonicalStore.open({
    location,
    clock,
    logger,
  });
  assert.equal(
    (await restartedCanonicalStore.getMetadata()).currentRevision,
    resolvedCommitOptions.resultRevision,
  );
  const lifecycleDatabase = new DatabaseSync(location.canonicalDatabasePath, { readOnly: true });
  const lifecycleRows = lifecycleDatabase.prepare(
    "SELECT event_id, event_type, event_json FROM novel_outbox WHERE event_type LIKE 'novel.rebase.%'",
  ).all();
  lifecycleDatabase.close();
  for (const [eventId, eventType] of [
    [`rebase-prepared:${planCandidate.candidate.session.id}`, "rebase.prepared"],
    [`rebase-resolved:${replayedResolvedCandidate.session.id}`, "rebase.resolved"],
    [`rebase-promoted:${replayedResolvedCandidate.session.id}`, "rebase.promoted"],
  ]) {
    const row = lifecycleRows.find((entry) => entry.event_id === eventId);
    assert.equal(JSON.parse(row.event_json).eventType, eventType);
  }
  await restartedCanonicalStore.close();
  await resolvedCandidateStore.close();
  assert.equal(
    await application.locationQueries.get(
      draftNovelReadScope(planCandidate.candidate.session),
      "location_plan_original",
    ) instanceof Object,
    true,
  );

  const planDatabasePath = join(
    candidatePath(location, planCandidate.candidate.session),
    "draft.sqlite",
  );
  const sourceDatabasePath = join(
    candidatePath(location, planSource),
    "draft.sqlite",
  );
  const sourceDatabase = new DatabaseSync(sourceDatabasePath);
  const sourceDigest = sourceDatabase
    .prepare(
      "SELECT operation_digest FROM draft_operations WHERE sequence = 1",
    )
    .get().operation_digest;
  sourceDatabase.prepare(
    "UPDATE draft_operations SET operation_digest = ? WHERE sequence = 1",
  ).run(`sha256:${"0".repeat(64)}`);
  sourceDatabase.close();
  await assert.rejects(
    planBuilder.buildAndSave(planCandidate.candidate),
    NovelInvariantViolationError,
  );
  const repairedSourceDatabase = new DatabaseSync(sourceDatabasePath);
  repairedSourceDatabase.prepare(
    "UPDATE draft_operations SET operation_digest = ? WHERE sequence = 1",
  ).run(sourceDigest);
  repairedSourceDatabase.close();

  const planDatabase = new DatabaseSync(planDatabasePath);
  planDatabase.prepare(
    `UPDATE resolution_application_entries
     SET operation_digest = ? WHERE source_sequence = 4`,
  ).run(`sha256:${"0".repeat(64)}`);
  planDatabase.close();
  await assert.rejects(
    restartedPlanStore.getPlan(planCandidate.candidate.session),
    NovelInvariantViolationError,
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
    "FORBIDDEN_PLAN_SOURCE_0",
    "FORBIDDEN_PLAN_SOURCE_1",
    "FORBIDDEN_PLAN_SOURCE_2",
    "FORBIDDEN_PLAN_SOURCE_3",
    "FORBIDDEN_PLAN_CANONICAL_0",
    "FORBIDDEN_PLAN_CANONICAL_1",
    "FORBIDDEN_PLAN_CANONICAL_2",
    "FORBIDDEN_PLAN_CANONICAL_3",
    "FORBIDDEN_PLAN_MANUAL",
    "FORBIDDEN_PLAN_ORIGINAL_LOCATION",
    "FORBIDDEN_LOCATION_DRAFT",
    "FORBIDDEN_LOCATION_CANONICAL",
  ]);
} finally {
  await candidateStore?.close();
  await draftStore?.close();
  await canonicalStore?.close();
  await rm(root, { recursive: true, force: true });
}

console.log("novel rebase candidate smoke passed");
