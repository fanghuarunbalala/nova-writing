import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  NOVEL_INVARIANT_FAILURE,
  NOVEL_PROTOCOL_FAILURE,
  NovelInvariantViolationError,
  NovelOperationPreconditionError,
  NovelProtocolValidationError,
  NovelDraftSessionService,
  canonicalNovelReadScope,
  captureCharacterId,
  captureLocationId,
  captureNovelEntityVersion,
  captureNovelOperationId,
  captureNovelOperationVersion,
  captureNovelRevision,
  captureNovelTimestamp,
  draftNovelReadScope,
} from "../dist/index.js";
import {
  NodeNovelStoreLocator,
  NodeWorkspaceStoreLocator,
  SqliteNovelCanonicalStore,
  SqliteNovelDraftStore,
  SqliteNovelSnapshotter,
  createNodeNovelEntityApplication,
} from "../dist/node/index.js";

class SequenceDraftIdentityFactory {
  constructor() {
    this.sequence = 0;
  }

  createDraftSessionId() {
    this.sequence += 1;
    return `draft_entity_slice_${this.sequence}`;
  }
}

class SequenceEntityIdentityFactory {
  constructor() {
    this.sequence = 0;
  }

  createOperationId() {
    this.sequence += 1;
    return captureNovelOperationId(`entity_operation_${this.sequence}`);
  }
}

class SequenceClock {
  constructor() {
    this.offset = 0;
  }

  now() {
    return captureNovelTimestamp(
      new Date(Date.UTC(2026, 7, 2, 8, 0, 0, this.offset++)).toISOString(),
    );
  }
}

class CollectingLogger {
  constructor(entries = [], bindings = {}) {
    this.entries = entries;
    this.bindings = bindings;
  }

  debug(event, fields = {}) {
    this.record("debug", event, fields);
  }

  info(event, fields = {}) {
    this.record("info", event, fields);
  }

  warn(event, fields = {}) {
    this.record("warn", event, fields);
  }

  error(event, fields = {}) {
    this.record("error", event, fields);
  }

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

function inspectDraft(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return {
      operations: database
        .prepare("SELECT COUNT(*) AS count FROM draft_operations")
        .get().count,
      operationCount: database
        .prepare(
          "SELECT operation_count FROM draft_metadata WHERE singleton = 1",
        )
        .get().operation_count,
      sequences: database
        .prepare("SELECT sequence FROM draft_operations ORDER BY sequence")
        .all()
        .map((row) => row.sequence),
      outbox: database
        .prepare("SELECT event_json FROM draft_outbox ORDER BY operation_sequence")
        .all(),
    };
  } finally {
    database.close();
  }
}

function assertRedacted(entries, forbiddenValues) {
  const serialized = JSON.stringify(entries);
  for (const value of forbiddenValues) {
    assert.equal(serialized.includes(value), false);
  }
  for (const entry of entries) {
    for (const key of Object.keys(entry.fields)) {
      assert.equal(
        [
          "payload",
          "profile",
          "prompt",
          "content",
          "text",
          "error",
          "message",
          "stack",
          "cause",
          "path",
        ].includes(key),
        false,
      );
    }
  }
}

const root = await mkdtemp(join(tmpdir(), "novel-entity-slice-"));
const workspaceRoot = join(root, "workspace");
const logEntries = [];
const logger = new CollectingLogger(logEntries);
let canonicalStore;
let draftStore;

try {
  await mkdir(workspaceRoot, { recursive: true });
  const workspace = await new NodeWorkspaceStoreLocator({
    storageRoot: join(root, "storage"),
  }).resolve(workspaceRoot);
  const location = await new NodeNovelStoreLocator().resolve(workspace);
  canonicalStore = await SqliteNovelCanonicalStore.open({ location, logger });
  const canonical = await canonicalStore.getMetadata();
  draftStore = await SqliteNovelDraftStore.open({
    location,
    novelId: canonical.novelId,
    logger,
  });
  const clock = new SequenceClock();
  const snapshotter = new SqliteNovelSnapshotter({
    location,
    novelId: canonical.novelId,
    logger,
  });
  const draftSessions = new NovelDraftSessionService({
    canonicalStore,
    draftStore,
    snapshotter,
    identityFactory: new SequenceDraftIdentityFactory(),
    clock,
    logger,
  });
  const session = await draftSessions.startDraft("conversation-entity-slice");
  const isolatedSession = await draftSessions.startDraft(
    "conversation-entity-isolated",
  );
  const identityFactory = new SequenceEntityIdentityFactory();
  const application = createNodeNovelEntityApplication({
    location,
    novelId: canonical.novelId,
    identityFactory,
    clock,
    logger,
  });
  const draftScope = draftNovelReadScope(session);
  const characterId = captureCharacterId("character_protagonist");
  const locationId = captureLocationId("location_harbor");
  const forbiddenName = "FORBIDDEN_CHARACTER_NAME";
  const forbiddenSummary = "FORBIDDEN_LOCATION_SUMMARY";

  await application.characters.create(session, characterId, {
    name: forbiddenName,
    aliases: ["Protagonist"],
    summary: "A progressively completed stable profile.",
  });
  await application.locations.create(session, locationId, {
    name: "Harbor District",
    aliases: ["Old Harbor"],
    summary: forbiddenSummary,
  });

  assert.deepEqual(await application.characterQueries.list(canonicalNovelReadScope), []);
  assert.deepEqual(await application.locationQueries.list(canonicalNovelReadScope), []);
  assert.deepEqual(
    await application.characterQueries.list(
      draftNovelReadScope(isolatedSession),
    ),
    [],
  );
  assert.deepEqual(
    await application.locationQueries.list(
      draftNovelReadScope(isolatedSession),
    ),
    [],
  );
  const initialCharacter = await application.characterQueries.get(
    draftScope,
    characterId,
  );
  const initialLocation = await application.locationQueries.get(
    draftScope,
    locationId,
  );
  assert.equal(initialCharacter.entityVersion, 1);
  assert.equal(initialLocation.entityVersion, 1);

  await assert.rejects(
    application.characters.create(session, characterId, {
      name: "Duplicate Character",
      aliases: [],
    }),
    (error) =>
      error instanceof NovelOperationPreconditionError &&
      error.failure === "entity_exists",
  );

  await application.characters.replace(
    session,
    characterId,
    captureNovelEntityVersion(1),
    {
      name: forbiddenName,
      aliases: ["Protagonist", "Traveler"],
      initialState: "Arrives without local allies.",
    },
  );
  await application.locations.replace(
    session,
    locationId,
    captureNovelEntityVersion(1),
    {
      name: "Harbor District",
      aliases: ["Old Harbor"],
      authorNotes: "Keep architecture descriptions stable.",
    },
  );
  const replacedCharacter = await application.characterQueries.get(
    draftScope,
    characterId,
  );
  const replacedLocation = await application.locationQueries.get(
    draftScope,
    locationId,
  );
  assert.equal(replacedCharacter.entityVersion, 2);
  assert.equal(replacedCharacter.summary, undefined);
  assert.equal(replacedCharacter.createdAt, initialCharacter.createdAt);
  assert.notEqual(replacedCharacter.updatedAt, replacedCharacter.createdAt);
  assert.equal(replacedLocation.entityVersion, 2);
  assert.equal(replacedLocation.summary, undefined);
  assert.equal(replacedLocation.createdAt, initialLocation.createdAt);

  await assert.rejects(
    application.characters.replace(
      session,
      characterId,
      captureNovelEntityVersion(1),
      { name: forbiddenName, aliases: [] },
    ),
    (error) =>
      error instanceof NovelOperationPreconditionError &&
      error.failure === "entity_version_mismatch",
  );

  await assert.rejects(
    application.characters.create(session, captureCharacterId("character_invalid"), {
      name: "Invalid Dynamic Profile",
      aliases: [],
      currentLocation: "location_harbor",
    }),
    (error) =>
      error instanceof NovelProtocolValidationError &&
      error.failure === NOVEL_PROTOCOL_FAILURE.invalidOperation,
  );

  for (const [id, profile] of [
    ["character_invalid_trim", { name: " Trimmed", aliases: [] }],
    [
      "character_invalid_duplicate_alias",
      { name: "Alias Owner", aliases: ["Duplicate", "duplicate"] },
    ],
    [
      "character_invalid_name_alias",
      { name: "Same Name", aliases: ["same name"] },
    ],
    [
      "character_invalid_oversized",
      { name: "Oversized", aliases: [], summary: "x".repeat(20_001) },
    ],
  ]) {
    await assert.rejects(
      application.characters.create(session, captureCharacterId(id), profile),
      (error) =>
        error instanceof NovelProtocolValidationError &&
        error.failure === NOVEL_PROTOCOL_FAILURE.invalidOperation &&
        error.field === "entityProfile",
    );
  }

  await assert.rejects(
    application.mutations.execute(session, {
      operationId: captureNovelOperationId("entity_operation_malformed"),
      operationVersion: captureNovelOperationVersion(1),
      type: "character.create",
      expected: [{
        kind: "entity-absent",
        entityType: "character",
        entityId: "character_malformed",
      }],
      payload: {
        id: "character_malformed",
        name: "Malformed",
        aliases: [],
        timestamp: clock.now(),
        summary: null,
        initialState: null,
        authorNotes: null,
        expectedEntityVersion: null,
        currentLocation: "location_harbor",
      },
    }),
    (error) =>
      error instanceof NovelProtocolValidationError &&
      error.failure === NOVEL_PROTOCOL_FAILURE.invalidOperation,
  );

  await assert.rejects(
    application.mutations.execute(session, {
      operationId: captureNovelOperationId("entity_operation_misaligned"),
      operationVersion: captureNovelOperationVersion(1),
      type: "character.create",
      expected: [{
        kind: "entity-absent",
        entityType: "character",
        entityId: "character_other",
      }],
      payload: {
        id: "character_misaligned",
        name: "Misaligned",
        aliases: [],
        timestamp: clock.now(),
        summary: null,
        initialState: null,
        authorNotes: null,
        expectedEntityVersion: null,
      },
    }),
    (error) =>
      error instanceof NovelProtocolValidationError &&
      error.failure === NOVEL_PROTOCOL_FAILURE.invalidOperation &&
      error.field === "operationPrecondition",
  );

  await assert.rejects(
    application.characterQueries.get(
      draftNovelReadScope({
        ...session,
        baseRevision: captureNovelRevision("revision_mismatched_scope"),
      }),
      characterId,
    ),
    (error) =>
      error instanceof NovelInvariantViolationError &&
      error.failure === NOVEL_INVARIANT_FAILURE.persistenceInvariant,
  );

  const restarted = createNodeNovelEntityApplication({
    location,
    novelId: canonical.novelId,
    identityFactory,
    clock,
    logger,
  });
  assert.equal((await restarted.characterQueries.get(draftScope, characterId)).entityVersion, 2);
  assert.equal((await restarted.locationQueries.get(draftScope, locationId)).entityVersion, 2);

  await assert.rejects(
    restarted.locations.delete(
      session,
      locationId,
      captureNovelEntityVersion(1),
    ),
    (error) =>
      error instanceof NovelOperationPreconditionError &&
      error.failure === "entity_version_mismatch",
  );

  await restarted.characters.delete(
    session,
    characterId,
    captureNovelEntityVersion(2),
  );
  await restarted.locations.delete(
    session,
    locationId,
    captureNovelEntityVersion(2),
  );
  await assert.rejects(
    restarted.characters.delete(
      session,
      characterId,
      captureNovelEntityVersion(2),
    ),
    (error) =>
      error instanceof NovelOperationPreconditionError &&
      error.failure === "entity_missing",
  );
  assert.equal(await restarted.characterQueries.get(draftScope, characterId), undefined);
  assert.equal(await restarted.locationQueries.get(draftScope, locationId), undefined);
  assert.deepEqual(await restarted.characterQueries.list(canonicalNovelReadScope), []);
  assert.deepEqual(await restarted.locationQueries.list(canonicalNovelReadScope), []);

  const draftState = inspectDraft(
    join(
      location.stagingDir,
      session.ownerConversationId,
      session.id,
      "draft.sqlite",
    ),
  );
  assert.equal(draftState.operations, 6);
  assert.equal(draftState.operationCount, 6);
  assert.deepEqual(draftState.sequences, [1, 2, 3, 4, 5, 6]);
  assert.equal(draftState.outbox.length, 6);
  assert.equal(
    draftState.outbox.some((row) =>
      row.event_json.includes(forbiddenName) ||
      row.event_json.includes(forbiddenSummary)),
    false,
  );
  assertRedacted(logEntries, [
    root,
    forbiddenName,
    forbiddenSummary,
    "Arrives without local allies.",
    "Keep architecture descriptions stable.",
  ]);
} finally {
  await draftStore?.close();
  await canonicalStore?.close();
  await rm(root, { recursive: true, force: true });
}

console.log("novel entity slice smoke passed");
