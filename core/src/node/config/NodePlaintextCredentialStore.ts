/** Stores permission-restricted plaintext credentials under global NOVEL_HOME. */
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

const CREDENTIAL_RECORD_SCHEMA_VERSION = 1 as const;
const CREDENTIAL_FILE_SUFFIX = ".plaintext-credential";
const LOCK_RETRY_DELAY_MS = 25;

export interface NodePlaintextCredentialStoreOptions {
  readonly homeResolver: ConfigurationHomeResolver;
  readonly lockTimeoutMs?: number;
  readonly staleLockMs?: number;
  readonly logger?: Logger;
}

interface PlaintextCredentialRecord {
  readonly schemaVersion: typeof CREDENTIAL_RECORD_SCHEMA_VERSION;
  readonly value: string;
}

export class NodePlaintextCredentialStore implements CredentialStore {
  readonly #homeResolver: ConfigurationHomeResolver;
  readonly #lockTimeoutMs: number;
  readonly #staleLockMs: number;
  readonly #logger: Logger;

  constructor(options: NodePlaintextCredentialStoreOptions) {
    this.#homeResolver = options.homeResolver;
    this.#lockTimeoutMs = captureDuration(
      options.lockTimeoutMs ?? 5_000,
      "Credential lock timeout",
    );
    this.#staleLockMs = captureDuration(
      options.staleLockMs ?? 30_000,
      "Credential stale lock duration",
    );
    this.#logger = (options.logger ?? noopLogger).child({
      component: "node_plaintext_credential_store",
    });
  }

  async getStatus(reference: CredentialReference): Promise<CredentialStatus> {
    assertReference(reference);
    this.#logger.debug("configuration.credential.status_started");
    const filePath = await this.#resolvePath(reference);
    try {
      await this.#readRecord(filePath);
      this.#logger.debug("configuration.credential.status_completed", {
        status: "configured",
      });
      return "configured";
    } catch (error) {
      if (isStoreFailure(error, NODE_CONFIGURATION_STORE_FAILURE.credentialMissing)) {
        this.#logger.debug("configuration.credential.status_completed", {
          status: "missing",
        });
        return "missing";
      }
      throw error;
    }
  }

  async save(reference: CredentialReference, secret: string): Promise<void> {
    assertReference(reference);
    const record: PlaintextCredentialRecord = {
      schemaVersion: CREDENTIAL_RECORD_SCHEMA_VERSION,
      value: captureSecret(secret),
    };
    this.#logger.debug("configuration.credential.save_started");
    const filePath = await this.#resolvePath(reference);
    await this.#withLock(filePath, () => this.#writeAtomically(filePath, record));
    this.#logger.info("configuration.credential.save_completed");
  }

  async use<TResult>(
    reference: CredentialReference,
    operation: (secret: string) => Promise<TResult>,
  ): Promise<TResult> {
    assertReference(reference);
    if (typeof operation !== "function") {
      throw new TypeError("Credential operation is invalid");
    }
    this.#logger.debug("configuration.credential.use_started");
    const filePath = await this.#resolvePath(reference);
    const record = await this.#withLock(filePath, () => this.#readRecord(filePath));
    const result = await operation(record.value);
    this.#logger.debug("configuration.credential.use_completed");
    return result;
  }

  async delete(reference: CredentialReference): Promise<void> {
    assertReference(reference);
    this.#logger.debug("configuration.credential.delete_started");
    const filePath = await this.#resolvePath(reference);
    await this.#withLock(filePath, async () => {
      let deleted = false;
      try {
        await unlink(filePath);
        deleted = true;
      } catch (error) {
        if (!isNodeError(error, "ENOENT")) {
          throw new NodeConfigurationStoreError(
            NODE_CONFIGURATION_STORE_FAILURE.credentialWriteFailed,
            true,
          );
        }
      }
      if (deleted) await this.#syncDirectory(dirname(filePath));
    });
    this.#logger.info("configuration.credential.delete_completed");
  }

  async #resolvePath(reference: CredentialReference): Promise<string> {
    let credentialsDir: string;
    try {
      const home = await this.#homeResolver.resolve();
      credentialsDir = home.credentialsDir;
      await this.#ensureCredentialsDirectory(credentialsDir);
    } catch (error) {
      if (error instanceof NodeConfigurationStoreError) throw error;
      throw new NodeConfigurationStoreError(
        NODE_CONFIGURATION_STORE_FAILURE.credentialUnavailable,
        true,
      );
    }
    const digest = createHash("sha256").update(reference.id, "utf8").digest("hex");
    return join(credentialsDir, `${digest}${CREDENTIAL_FILE_SUFFIX}`);
  }

  async #ensureCredentialsDirectory(credentialsDir: string): Promise<void> {
    await mkdir(credentialsDir, { recursive: true, mode: 0o700 });
    const directoryStats = await lstat(credentialsDir);
    if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
      throw new NodeConfigurationStoreError(
        NODE_CONFIGURATION_STORE_FAILURE.credentialUnavailable,
      );
    }
    await chmod(credentialsDir, 0o700);
  }

  async #readRecord(filePath: string): Promise<PlaintextCredentialRecord> {
    let contents: string;
    try {
      const fileStats = await lstat(filePath);
      if (!fileStats.isFile() || fileStats.isSymbolicLink()) {
        throw new NodeConfigurationStoreError(
          NODE_CONFIGURATION_STORE_FAILURE.credentialCorrupted,
        );
      }
      await chmod(filePath, 0o600);
      contents = await readFile(filePath, "utf8");
    } catch (error) {
      if (error instanceof NodeConfigurationStoreError) throw error;
      if (isNodeError(error, "ENOENT")) {
        throw new NodeConfigurationStoreError(
          NODE_CONFIGURATION_STORE_FAILURE.credentialMissing,
        );
      }
      throw new NodeConfigurationStoreError(
        NODE_CONFIGURATION_STORE_FAILURE.readFailed,
        true,
      );
    }
    try {
      const record = JSON.parse(contents) as Partial<PlaintextCredentialRecord>;
      if (record.schemaVersion !== CREDENTIAL_RECORD_SCHEMA_VERSION) {
        throw new TypeError();
      }
      return {
        schemaVersion: record.schemaVersion,
        value: captureSecret(record.value),
      };
    } catch {
      throw new NodeConfigurationStoreError(
        NODE_CONFIGURATION_STORE_FAILURE.credentialCorrupted,
      );
    }
  }

  async #writeAtomically(
    filePath: string,
    record: PlaintextCredentialRecord,
  ): Promise<void> {
    const credentialsDir = dirname(filePath);
    await this.#ensureCredentialsDirectory(credentialsDir);
    const temporaryPath = join(
      credentialsDir,
      `.${randomUUID()}${CREDENTIAL_FILE_SUFFIX}.tmp`,
    );
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.chmod(0o600);
      await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, filePath);
      await chmod(filePath, 0o600);
      await this.#syncDirectory(credentialsDir);
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
    filePath: string,
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    const lockPath = `${filePath}.lock`;
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
        if (await this.#removeStaleLock(lockPath)) {
          this.#logger.warn("configuration.credential.lock_recovered");
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

  async #removeStaleLock(lockPath: string): Promise<boolean> {
    try {
      const lockStats = await stat(lockPath);
      if (Date.now() - lockStats.mtimeMs <= this.#staleLockMs) return false;
      await unlink(lockPath).catch(() => undefined);
      return true;
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return false;
      throw new NodeConfigurationStoreError(
        NODE_CONFIGURATION_STORE_FAILURE.credentialWriteFailed,
        true,
      );
    }
  }
}

function assertReference(reference: CredentialReference): void {
  if (!(reference instanceof CredentialReference)) {
    throw new TypeError("Credential reference is invalid");
  }
}

function captureSecret(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 1_048_576) {
    throw new TypeError("Credential secret is invalid");
  }
  return value;
}

function captureDuration(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function isStoreFailure(
  error: unknown,
  failure: string,
): error is NodeConfigurationStoreError {
  return error instanceof NodeConfigurationStoreError && error.failure === failure;
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
