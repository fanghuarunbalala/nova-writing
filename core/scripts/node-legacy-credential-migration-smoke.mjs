import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CredentialReference } from "../dist/index.js";
import {
  CREDENTIAL_MIGRATION_OUTCOME,
  CREDENTIAL_MIGRATION_PHASE,
  NODE_CONFIGURATION_STORE_FAILURE,
  NodeConfigurationHomeResolver,
  NodeConfigurationStoreError,
  NodeCredentialMigrationStateStore,
  NodeEncryptedCredentialStore,
  NodeLegacyCredentialMigrator,
  NodePlaintextCredentialStore,
} from "../dist/node/index.js";

class FakeCredentialCipher {
  available = true;

  async isAvailable() {
    return this.available;
  }

  async encrypt(secret) {
    return Buffer.from(`encrypted:${secret}`, "utf8").reverse();
  }

  async decrypt(encrypted) {
    const value = Buffer.from(encrypted).reverse().toString("utf8");
    if (!value.startsWith("encrypted:")) throw new Error("invalid");
    return { secret: value.slice("encrypted:".length), shouldReEncrypt: false };
  }
}

class CollectingLogger {
  constructor(entries = [], bindings = {}) {
    this.entries = entries;
    this.bindings = bindings;
  }

  debug(event, fields) {
    this.#capture("debug", event, fields);
  }

  info(event, fields) {
    this.#capture("info", event, fields);
  }

  warn(event, fields) {
    this.#capture("warn", event, fields);
  }

  error(event, fields) {
    this.#capture("error", event, fields);
  }

  child(bindings) {
    return new CollectingLogger(this.entries, { ...this.bindings, ...bindings });
  }

  #capture(level, event, fields) {
    this.entries.push({ level, event, fields, bindings: this.bindings });
  }
}

class FailOnceCredentialStore {
  constructor(delegate, operation) {
    this.delegate = delegate;
    this.operation = operation;
    this.failed = false;
  }

  getStatus(reference) {
    return this.delegate.getStatus(reference);
  }

  async save(reference, secret) {
    if (this.operation === "save" && !this.failed) {
      this.failed = true;
      throw new NodeConfigurationStoreError(
        NODE_CONFIGURATION_STORE_FAILURE.credentialWriteFailed,
        true,
      );
    }
    return this.delegate.save(reference, secret);
  }

  use(reference, operation) {
    return this.delegate.use(reference, operation);
  }

  async delete(reference) {
    if (this.operation === "delete" && !this.failed) {
      this.failed = true;
      throw new NodeConfigurationStoreError(
        NODE_CONFIGURATION_STORE_FAILURE.credentialWriteFailed,
        true,
      );
    }
    return this.delegate.delete(reference);
  }
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "novel-credential-migration-"));
try {
  const logger = new CollectingLogger();
  const homeResolver = new NodeConfigurationHomeResolver({ rootDir: temporaryRoot });
  const cipher = new FakeCredentialCipher();
  const legacyStore = new NodeEncryptedCredentialStore({ homeResolver, cipher });
  const plaintextStore = new NodePlaintextCredentialStore({ homeResolver });
  const stateStore = new NodeCredentialMigrationStateStore({ homeResolver, logger });
  const createMigrator = (overrides = {}) => new NodeLegacyCredentialMigrator({
    legacyStore,
    plaintextStore,
    stateStore,
    logger,
    ...overrides,
  });

  const missingReference = reference("missing");
  assert.equal(
    (await createMigrator().migrate(missingReference)).outcome,
    CREDENTIAL_MIGRATION_OUTCOME.notRequired,
  );

  const primaryReference = reference("primary");
  await legacyStore.save(primaryReference, "legacy-primary-secret");
  assert.equal(
    (await createMigrator().migrate(primaryReference)).outcome,
    CREDENTIAL_MIGRATION_OUTCOME.migrated,
  );
  assert.equal(await legacyStore.getStatus(primaryReference), "missing");
  assert.equal(await plaintextStore.getStatus(primaryReference), "configured");
  assert.equal(
    await plaintextStore.use(primaryReference, async (secret) => secret),
    "legacy-primary-secret",
  );
  assert.equal(await stateStore.load(primaryReference), undefined);
  assert.equal(
    (await createMigrator().migrate(primaryReference)).outcome,
    CREDENTIAL_MIGRATION_OUTCOME.alreadyMigrated,
  );

  const startedReference = reference("started-source-only");
  await legacyStore.save(startedReference, "started-source-secret");
  await stateStore.save(startedReference, state(CREDENTIAL_MIGRATION_PHASE.started));
  assert.equal(
    (await createMigrator().migrate(startedReference)).outcome,
    CREDENTIAL_MIGRATION_OUTCOME.resumed,
  );
  assert.equal(
    await plaintextStore.use(startedReference, async (secret) => secret),
    "started-source-secret",
  );

  const bothReference = reference("started-both");
  await legacyStore.save(bothReference, "older-legacy-secret");
  await plaintextStore.save(bothReference, "newer-plaintext-secret");
  await stateStore.save(bothReference, state(CREDENTIAL_MIGRATION_PHASE.started));
  assert.equal(
    (await createMigrator().migrate(bothReference)).outcome,
    CREDENTIAL_MIGRATION_OUTCOME.resumed,
  );
  assert.equal(
    await plaintextStore.use(bothReference, async (secret) => secret),
    "newer-plaintext-secret",
  );
  assert.equal(await legacyStore.getStatus(bothReference), "missing");

  const stagedReference = reference("staged-target-only");
  await plaintextStore.save(stagedReference, "staged-target-secret");
  await stateStore.save(
    stagedReference,
    state(CREDENTIAL_MIGRATION_PHASE.plaintextSaved),
  );
  assert.equal(
    (await createMigrator().migrate(stagedReference)).outcome,
    CREDENTIAL_MIGRATION_OUTCOME.resumed,
  );
  assert.equal(await stateStore.load(stagedReference), undefined);

  const interruptedSaveReference = reference("interrupted-save");
  await legacyStore.save(interruptedSaveReference, "interrupted-save-secret");
  await assert.rejects(
    createMigrator({
      plaintextStore: new FailOnceCredentialStore(plaintextStore, "save"),
    }).migrate(interruptedSaveReference),
    (error) => assertStoreFailure(
      error,
      NODE_CONFIGURATION_STORE_FAILURE.credentialWriteFailed,
    ),
  );
  assert.equal(
    (await stateStore.load(interruptedSaveReference))?.phase,
    CREDENTIAL_MIGRATION_PHASE.started,
  );
  assert.equal(
    (await createMigrator().migrate(interruptedSaveReference)).outcome,
    CREDENTIAL_MIGRATION_OUTCOME.resumed,
  );

  const interruptedDeleteReference = reference("interrupted-delete");
  await legacyStore.save(interruptedDeleteReference, "interrupted-delete-secret");
  await assert.rejects(
    createMigrator({
      legacyStore: new FailOnceCredentialStore(legacyStore, "delete"),
    }).migrate(interruptedDeleteReference),
    (error) => assertStoreFailure(
      error,
      NODE_CONFIGURATION_STORE_FAILURE.credentialWriteFailed,
    ),
  );
  assert.equal(
    (await stateStore.load(interruptedDeleteReference))?.phase,
    CREDENTIAL_MIGRATION_PHASE.plaintextSaved,
  );
  assert.equal(
    (await createMigrator().migrate(interruptedDeleteReference)).outcome,
    CREDENTIAL_MIGRATION_OUTCOME.resumed,
  );

  const conflictReference = reference("conflict");
  await legacyStore.save(conflictReference, "conflict-legacy-secret");
  await plaintextStore.save(conflictReference, "conflict-plaintext-secret");
  await assert.rejects(
    createMigrator().migrate(conflictReference),
    (error) => assertStoreFailure(
      error,
      NODE_CONFIGURATION_STORE_FAILURE.credentialMigrationConflict,
    ),
  );
  assert.equal(await legacyStore.getStatus(conflictReference), "configured");
  assert.equal(
    await plaintextStore.use(conflictReference, async (secret) => secret),
    "conflict-plaintext-secret",
  );

  const corruptedStateReference = reference("corrupted-state");
  const corruptedStatePath = migrationStatePath(temporaryRoot, corruptedStateReference);
  await writeFile(corruptedStatePath, '{"schemaVersion":1,"phase":"invalid"}\n', {
    mode: 0o600,
  });
  await assert.rejects(
    createMigrator().migrate(corruptedStateReference),
    (error) => assertStoreFailure(
      error,
      NODE_CONFIGURATION_STORE_FAILURE.credentialMigrationStateCorrupted,
    ),
  );

  const corruptedLegacyReference = reference("corrupted-legacy");
  await legacyStore.save(corruptedLegacyReference, "corrupted-legacy-secret");
  await writeFile(legacyPath(temporaryRoot, corruptedLegacyReference), "invalid\n", {
    mode: 0o600,
  });
  await assert.rejects(
    createMigrator().migrate(corruptedLegacyReference),
    (error) => assertStoreFailure(
      error,
      NODE_CONFIGURATION_STORE_FAILURE.credentialCorrupted,
    ),
  );

  const unavailableReference = reference("unavailable");
  cipher.available = false;
  await assert.rejects(
    createMigrator().migrate(unavailableReference),
    (error) => assertStoreFailure(
      error,
      NODE_CONFIGURATION_STORE_FAILURE.credentialUnavailable,
    ),
  );
  cipher.available = true;

  const concurrentReference = reference("concurrent");
  await legacyStore.save(concurrentReference, "concurrent-migration-secret");
  const concurrentOutcomes = await Promise.all([
    createMigrator().migrate(concurrentReference),
    createMigrator().migrate(concurrentReference),
  ]);
  assert.deepEqual(
    concurrentOutcomes.map((entry) => entry.outcome).sort(),
    [
      CREDENTIAL_MIGRATION_OUTCOME.alreadyMigrated,
      CREDENTIAL_MIGRATION_OUTCOME.migrated,
    ].sort(),
  );

  const credentialsDir = join(temporaryRoot, "credentials");
  const remainingMigrationFiles = (await readdir(credentialsDir)).filter((name) =>
    name.endsWith(".credential-migration.json"),
  );
  assert.equal(remainingMigrationFiles.includes(
    `${digest(corruptedStateReference)}.credential-migration.json`,
  ), true);
  if (process.platform !== "win32") {
    assert.equal((await stat(corruptedStatePath)).mode & 0o777, 0o600);
  }

  const serializedLogs = JSON.stringify(logger.entries);
  for (const forbidden of [
    temporaryRoot,
    primaryReference.id,
    "legacy-primary-secret",
    "interrupted-save-secret",
    "interrupted-delete-secret",
    "concurrent-migration-secret",
  ]) {
    assert.equal(serializedLogs.includes(forbidden), false, forbidden);
  }

  console.log("Node Legacy Credential Migration smoke passed");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function reference(suffix) {
  return new CredentialReference(`credential:migration-${suffix}`);
}

function state(phase) {
  return { schemaVersion: 1, phase };
}

function digest(reference) {
  return createHash("sha256").update(reference.id, "utf8").digest("hex");
}

function migrationStatePath(root, reference) {
  return join(root, "credentials", `${digest(reference)}.credential-migration.json`);
}

function legacyPath(root, reference) {
  return join(root, "credentials", `${digest(reference)}.credential`);
}

function assertStoreFailure(error, failure) {
  assert.equal(error instanceof NodeConfigurationStoreError, true);
  assert.equal(error.failure, failure);
  return true;
}
