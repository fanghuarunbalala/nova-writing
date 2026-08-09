/** Migrates known legacy encrypted credentials into the V1 plaintext store. */
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { syncDirectoryBestEffort } from "../fs/syncDirectory.js";
import {
  CredentialReference,
  type ConfigurationHomeResolver,
  type CredentialStatus,
  type CredentialStore,
} from "../../config/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import { syncDirectoryBestEffort } from "../fs/index.js";
import {
  NODE_CONFIGURATION_STORE_FAILURE,
  NodeConfigurationStoreError,
} from "./NodeConfigurationStoreErrors.js";

const MIGRATION_STATE_SCHEMA_VERSION = 1 as const;
const MIGRATION_RESULT_SCHEMA_VERSION = 1 as const;
const MIGRATION_STATE_SUFFIX = ".credential-migration.json";
const LOCK_RETRY_DELAY_MS = 25;

export const CREDENTIAL_MIGRATION_PHASE = Object.freeze({
  started: "started",
  plaintextSaved: "plaintext_saved",
} as const);

export type CredentialMigrationPhase =
  (typeof CREDENTIAL_MIGRATION_PHASE)[keyof typeof CREDENTIAL_MIGRATION_PHASE];

export interface CredentialMigrationState {
  readonly schemaVersion: typeof MIGRATION_STATE_SCHEMA_VERSION;
  readonly phase: CredentialMigrationPhase;
}

export const CREDENTIAL_MIGRATION_OUTCOME = Object.freeze({
  notRequired: "not_required",
  alreadyMigrated: "already_migrated",
  migrated: "migrated",
  resumed: "resumed",
} as const);

export type CredentialMigrationOutcome =
  (typeof CREDENTIAL_MIGRATION_OUTCOME)[keyof typeof CREDENTIAL_MIGRATION_OUTCOME];

export interface CredentialMigrationResult {
  readonly schemaVersion: typeof MIGRATION_RESULT_SCHEMA_VERSION;
  readonly outcome: CredentialMigrationOutcome;
}

export interface NodeCredentialMigrationStateStoreOptions {
  readonly homeResolver: ConfigurationHomeResolver;
  readonly lockTimeoutMs?: number;
  readonly staleLockMs?: number;
  readonly logger?: Logger;
}

export class NodeCredentialMigrationStateStore {
  readonly #homeResolver: ConfigurationHomeResolver;
  readonly #lockTimeoutMs: number;
  readonly #staleLockMs: number;
  readonly #logger: Logger;

  constructor(options: NodeCredentialMigrationStateStoreOptions) {
    this.#homeResolver = options.homeResolver;
    this.#lockTimeoutMs = captureDuration(options.lockTimeoutMs ?? 5_000);
    this.#staleLockMs = captureDuration(options.staleLockMs ?? 30_000);
    this.#logger = (options.logger ?? noopLogger).child({
      component: "node_credential_migration_state_store",
    });
  }

  async runExclusive<TResult>(
    reference: CredentialReference,
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    assertReference(reference);
    if (typeof operation !== "function") {
      throw new TypeError("Credential migration operation is invalid");
    }
    const statePath = await this.#resolveStatePath(reference);
    return this.#withLock(statePath, operation);
  }

  async load(reference: CredentialReference): Promise<CredentialMigrationState | undefined> {
    assertReference(reference);
    const statePath = await this.#resolveStatePath(reference);
    let contents: string;
    try {
      const stateStats = await lstat(statePath);
      if (!stateStats.isFile() || stateStats.isSymbolicLink()) throw new TypeError();
      await chmod(statePath, 0o600);
      contents = await readFile(statePath, "utf8");
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return undefined;
      if (error instanceof TypeError) {
        throw migrationStateCorrupted();
      }
      throw new NodeConfigurationStoreError(
        NODE_CONFIGURATION_STORE_FAILURE.readFailed,
        true,
      );
    }
    try {
      const state = JSON.parse(contents) as Partial<CredentialMigrationState>;
      if (
        state.schemaVersion !== MIGRATION_STATE_SCHEMA_VERSION ||
        !isMigrationPhase(state.phase)
      ) {
        throw new TypeError();
      }
      return Object.freeze({
        schemaVersion: state.schemaVersion,
        phase: state.phase,
      });
    } catch {
      throw migrationStateCorrupted();
    }
  }

  async save(
    reference: CredentialReference,
    state: CredentialMigrationState,
  ): Promise<void> {
    assertReference(reference);
    const captured = captureMigrationState(state);
    this.#logger.debug("configuration.credential_migration.state_save_started");
    const statePath = await this.#resolveStatePath(reference);
    await this.#writeAtomically(statePath, captured);
    this.#logger.debug("configuration.credential_migration.state_save_completed");
  }

  async delete(reference: CredentialReference): Promise<void> {
    assertReference(reference);
    const statePath = await this.#resolveStatePath(reference);
    try {
      await unlink(statePath);
      await this.#syncDirectory(dirname(statePath));
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) {
        throw new NodeConfigurationStoreError(
          NODE_CONFIGURATION_STORE_FAILURE.credentialWriteFailed,
          true,
        );
      }
    }
  }

  async #resolveStatePath(reference: CredentialReference): Promise<string> {
    let credentialsDir: string;
    try {
      const home = await this.#homeResolver.resolve();
      credentialsDir = home.credentialsDir;
      await ensureCredentialDirectory(credentialsDir);
    } catch (error) {
      if (error instanceof NodeConfigurationStoreError) throw error;
      throw new NodeConfigurationStoreError(
        NODE_CONFIGURATION_STORE_FAILURE.credentialUnavailable,
        true,
      );
    }
    const digest = createHash("sha256").update(reference.id, "utf8").digest("hex");
    return join(credentialsDir, `${digest}${MIGRATION_STATE_SUFFIX}`);
  }

  async #writeAtomically(
    statePath: string,
    state: CredentialMigrationState,
  ): Promise<void> {
    const directoryPath = dirname(statePath);
    const temporaryPath = join(
      directoryPath,
      `.${randomUUID()}${MIGRATION_STATE_SUFFIX}.tmp`,
    );
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.chmod(0o600);
      await handle.writeFile(`${JSON.stringify(state)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, statePath);
      await chmod(statePath, 0o600);
      await this.#syncDirectory(directoryPath);
    } catch {
      await handle?.close().catch(() => undefined);
      await unlink(temporaryPath).catch(() => undefined);
      throw new NodeConfigurationStoreError(
        NODE_CONFIGURATION_STORE_FAILURE.credentialWriteFailed,
        true,
      );
    }
  }

  async #syncDirectory(directoryPath: string): Promise<void> {
    try {
      await syncDirectoryBestEffort(directoryPath);
    } catch {
      throw new NodeConfigurationStoreError(
        NODE_CONFIGURATION_STORE_FAILURE.credentialWriteFailed,
        true,
      );
    }
  }

  async #withLock<TResult>(
    statePath: string,
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    const lockPath = `${statePath}.lock`;
    const deadline = Date.now() + this.#lockTimeoutMs;
    while (true) {
      try {
        const handle = await open(lockPath, "wx", 0o600);
        try {
          await handle.chmod(0o600);
          await handle.writeFile(
            JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
            "utf8",
          );
          await handle.sync();
          return await operation();
        } finally {
          await handle.close();
          await unlink(lockPath).catch(() => undefined);
        }
      } catch (error) {
        if (error instanceof NodeConfigurationStoreError) throw error;
        if (!isNodeError(error, "EEXIST")) {
          throw new NodeConfigurationStoreError(
            NODE_CONFIGURATION_STORE_FAILURE.credentialWriteFailed,
            true,
          );
        }
        if (await removeStaleLock(lockPath, this.#staleLockMs)) {
          this.#logger.warn("configuration.credential_migration.lock_recovered");
        }
        if (Date.now() >= deadline) {
          throw new NodeConfigurationStoreError(
            NODE_CONFIGURATION_STORE_FAILURE.lockTimeout,
            true,
          );
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, LOCK_RETRY_DELAY_MS));
      }
    }
  }
}

export interface NodeLegacyCredentialMigratorOptions {
  readonly legacyStore: CredentialStore;
  readonly plaintextStore: CredentialStore;
  readonly stateStore: NodeCredentialMigrationStateStore;
  readonly logger?: Logger;
}

export class NodeLegacyCredentialMigrator {
  readonly #legacyStore: CredentialStore;
  readonly #plaintextStore: CredentialStore;
  readonly #stateStore: NodeCredentialMigrationStateStore;
  readonly #logger: Logger;

  constructor(options: NodeLegacyCredentialMigratorOptions) {
    this.#legacyStore = options.legacyStore;
    this.#plaintextStore = options.plaintextStore;
    this.#stateStore = options.stateStore;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "node_legacy_credential_migrator",
    });
  }

  async migrate(reference: CredentialReference): Promise<CredentialMigrationResult> {
    assertReference(reference);
    this.#logger.debug("configuration.credential_migration.started");
    const migration = await this.#stateStore.runExclusive(reference, async () => {
      const state = await this.#stateStore.load(reference);
      const legacyStatus = await this.#readStatus(this.#legacyStore, reference);
      const plaintextStatus = await this.#readStatus(this.#plaintextStore, reference);

      if (state !== undefined) {
        return this.#resume(reference, legacyStatus, plaintextStatus);
      }
      if (legacyStatus === "missing" && plaintextStatus === "missing") {
        return migrationResult(CREDENTIAL_MIGRATION_OUTCOME.notRequired);
      }
      if (legacyStatus === "missing" && plaintextStatus === "configured") {
        return migrationResult(CREDENTIAL_MIGRATION_OUTCOME.alreadyMigrated);
      }
      if (legacyStatus === "configured" && plaintextStatus === "configured") {
        throw new NodeConfigurationStoreError(
          NODE_CONFIGURATION_STORE_FAILURE.credentialMigrationConflict,
        );
      }
      return this.#copy(reference, CREDENTIAL_MIGRATION_OUTCOME.migrated);
    });
    this.#logger.info("configuration.credential_migration.completed", {
      outcome: migration.outcome,
    });
    return migration;
  }

  async #resume(
    reference: CredentialReference,
    legacyStatus: Exclude<CredentialStatus, "unavailable">,
    plaintextStatus: Exclude<CredentialStatus, "unavailable">,
  ): Promise<CredentialMigrationResult> {
    if (plaintextStatus === "configured") {
      if (legacyStatus === "configured") await this.#legacyStore.delete(reference);
      await this.#stateStore.delete(reference);
      return migrationResult(CREDENTIAL_MIGRATION_OUTCOME.resumed);
    }
    if (legacyStatus === "missing") throw migrationStateCorrupted();
    return this.#copy(reference, CREDENTIAL_MIGRATION_OUTCOME.resumed);
  }

  async #copy(
    reference: CredentialReference,
    outcome: CredentialMigrationOutcome,
  ): Promise<CredentialMigrationResult> {
    await this.#stateStore.save(reference, state(CREDENTIAL_MIGRATION_PHASE.started));
    await this.#legacyStore.use(reference, async (secret) => {
      await this.#plaintextStore.save(reference, secret);
    });
    await this.#stateStore.save(
      reference,
      state(CREDENTIAL_MIGRATION_PHASE.plaintextSaved),
    );
    if (await this.#readStatus(this.#plaintextStore, reference) !== "configured") {
      throw migrationStateCorrupted();
    }
    await this.#legacyStore.delete(reference);
    await this.#stateStore.delete(reference);
    return migrationResult(outcome);
  }

  async #readStatus(
    store: CredentialStore,
    reference: CredentialReference,
  ): Promise<Exclude<CredentialStatus, "unavailable">> {
    const status = await store.getStatus(reference);
    if (status === "unavailable") {
      throw new NodeConfigurationStoreError(
        NODE_CONFIGURATION_STORE_FAILURE.credentialUnavailable,
        true,
      );
    }
    return status;
  }
}

function state(phase: CredentialMigrationPhase): CredentialMigrationState {
  return Object.freeze({ schemaVersion: MIGRATION_STATE_SCHEMA_VERSION, phase });
}

function migrationResult(
  outcome: CredentialMigrationOutcome,
): CredentialMigrationResult {
  return Object.freeze({ schemaVersion: MIGRATION_RESULT_SCHEMA_VERSION, outcome });
}

function captureMigrationState(value: CredentialMigrationState): CredentialMigrationState {
  if (
    value?.schemaVersion !== MIGRATION_STATE_SCHEMA_VERSION ||
    !isMigrationPhase(value.phase)
  ) {
    throw new TypeError("Credential migration state is invalid");
  }
  return state(value.phase);
}

function isMigrationPhase(value: unknown): value is CredentialMigrationPhase {
  return value === CREDENTIAL_MIGRATION_PHASE.started ||
    value === CREDENTIAL_MIGRATION_PHASE.plaintextSaved;
}

async function ensureCredentialDirectory(credentialsDir: string): Promise<void> {
  await mkdir(credentialsDir, { recursive: true, mode: 0o700 });
  const directoryStats = await lstat(credentialsDir);
  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
    throw new NodeConfigurationStoreError(
      NODE_CONFIGURATION_STORE_FAILURE.credentialUnavailable,
    );
  }
  await chmod(credentialsDir, 0o700);
}

async function removeStaleLock(lockPath: string, staleLockMs: number): Promise<boolean> {
  try {
    const lockStats = await stat(lockPath);
    if (Date.now() - lockStats.mtimeMs <= staleLockMs) return false;
    try {
      await unlink(lockPath);
      return true;
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return false;
      throw error;
    }
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false;
    throw new NodeConfigurationStoreError(
      NODE_CONFIGURATION_STORE_FAILURE.credentialWriteFailed,
      true,
    );
  }
}

function migrationStateCorrupted(): NodeConfigurationStoreError {
  return new NodeConfigurationStoreError(
    NODE_CONFIGURATION_STORE_FAILURE.credentialMigrationStateCorrupted,
  );
}

function assertReference(reference: CredentialReference): void {
  if (!(reference instanceof CredentialReference)) {
    throw new TypeError("Credential reference is invalid");
  }
}

function captureDuration(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Credential migration duration is invalid");
  }
  return value;
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
