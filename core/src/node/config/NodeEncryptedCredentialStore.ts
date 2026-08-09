/** Stores encrypted credential bytes under NOVEL_HOME without exposing plaintext reads. */
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import { syncDirectoryBestEffort } from "../fs/syncDirectory.js";
import {
  CredentialReference,
  type ConfigurationHomeResolver,
  type CredentialStatus,
  type CredentialStore,
} from "../../config/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  NODE_CONFIGURATION_STORE_FAILURE,
  NodeConfigurationStoreError,
} from "./NodeConfigurationStoreErrors.js";

const CREDENTIAL_RECORD_SCHEMA_VERSION = 1 as const;

export interface CredentialCipherDecryptResult {
  readonly secret: string;
  readonly shouldReEncrypt: boolean;
}

export interface CredentialCipher {
  isAvailable(): Promise<boolean>;
  encrypt(secret: string): Promise<Uint8Array>;
  decrypt(encrypted: Uint8Array): Promise<CredentialCipherDecryptResult>;
}

export interface NodeEncryptedCredentialStoreOptions {
  readonly homeResolver: ConfigurationHomeResolver;
  readonly cipher: CredentialCipher;
  readonly lockTimeoutMs?: number;
  readonly staleLockMs?: number;
  readonly logger?: Logger;
}

interface CredentialRecord {
  readonly schemaVersion: typeof CREDENTIAL_RECORD_SCHEMA_VERSION;
  readonly encryptedValue: string;
}

export class NodeEncryptedCredentialStore implements CredentialStore {
  readonly #homeResolver: ConfigurationHomeResolver;
  readonly #cipher: CredentialCipher;
  readonly #lockTimeoutMs: number;
  readonly #staleLockMs: number;
  readonly #logger: Logger;

  constructor(options: NodeEncryptedCredentialStoreOptions) {
    this.#homeResolver = options.homeResolver;
    this.#cipher = options.cipher;
    this.#lockTimeoutMs = options.lockTimeoutMs ?? 5_000;
    this.#staleLockMs = options.staleLockMs ?? 30_000;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "node_encrypted_credential_store",
    });
  }

  async getStatus(reference: CredentialReference): Promise<CredentialStatus> {
    assertReference(reference);
    if (!(await this.#cipher.isAvailable())) return "unavailable";
    try {
      await stat(await this.#resolvePath(reference));
      return "configured";
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return "missing";
      throw new NodeConfigurationStoreError(
        NODE_CONFIGURATION_STORE_FAILURE.readFailed,
        true,
      );
    }
  }

  async save(reference: CredentialReference, secret: string): Promise<void> {
    assertReference(reference);
    const capturedSecret = captureSecret(secret);
    if (!(await this.#cipher.isAvailable())) {
      throw new NodeConfigurationStoreError(
        NODE_CONFIGURATION_STORE_FAILURE.credentialUnavailable,
      );
    }
    this.#logger.debug("configuration.credential.save_started");
    let encrypted: Uint8Array;
    try {
      encrypted = await this.#cipher.encrypt(capturedSecret);
    } catch {
      throw new NodeConfigurationStoreError(
        NODE_CONFIGURATION_STORE_FAILURE.credentialWriteFailed,
        true,
      );
    }
    const record: CredentialRecord = {
      schemaVersion: CREDENTIAL_RECORD_SCHEMA_VERSION,
      encryptedValue: Buffer.from(encrypted).toString("base64"),
    };
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
    if (!(await this.#cipher.isAvailable())) {
      throw new NodeConfigurationStoreError(
        NODE_CONFIGURATION_STORE_FAILURE.credentialUnavailable,
      );
    }
    const record = await this.#readRecord(await this.#resolvePath(reference));
    let decrypted: CredentialCipherDecryptResult;
    try {
      decrypted = await this.#cipher.decrypt(
        Buffer.from(record.encryptedValue, "base64"),
      );
    } catch {
      throw new NodeConfigurationStoreError(
        NODE_CONFIGURATION_STORE_FAILURE.credentialCorrupted,
      );
    }
    const secret = captureSecret(decrypted.secret);
    const result = await operation(secret);
    if (decrypted.shouldReEncrypt) await this.save(reference, secret);
    return result;
  }

  async delete(reference: CredentialReference): Promise<void> {
    assertReference(reference);
    const filePath = await this.#resolvePath(reference);
    await this.#withLock(filePath, async () => {
      await unlink(filePath).catch((error) => {
        if (!isNodeError(error, "ENOENT")) {
          throw new NodeConfigurationStoreError(
            NODE_CONFIGURATION_STORE_FAILURE.credentialWriteFailed,
            true,
          );
        }
      });
    });
    this.#logger.info("configuration.credential.delete_completed");
  }

  async #resolvePath(reference: CredentialReference): Promise<string> {
    const home = await this.#homeResolver.resolve();
    const digest = createHash("sha256").update(reference.id, "utf8").digest("hex");
    return join(home.credentialsDir, `${digest}.credential`);
  }

  async #readRecord(filePath: string): Promise<CredentialRecord> {
    let contents: string;
    try {
      contents = await readFile(filePath, "utf8");
    } catch (error) {
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
      const record = JSON.parse(contents) as Partial<CredentialRecord>;
      if (
        record.schemaVersion !== CREDENTIAL_RECORD_SCHEMA_VERSION ||
        typeof record.encryptedValue !== "string" ||
        record.encryptedValue.length === 0
      ) {
        throw new TypeError();
      }
      return {
        schemaVersion: record.schemaVersion,
        encryptedValue: record.encryptedValue,
      };
    } catch {
      throw new NodeConfigurationStoreError(
        NODE_CONFIGURATION_STORE_FAILURE.credentialCorrupted,
      );
    }
  }

  async #writeAtomically(filePath: string, record: CredentialRecord): Promise<void> {
    const home = await this.#homeResolver.resolve();
    await mkdir(home.credentialsDir, { recursive: true, mode: 0o700 });
    const temporaryPath = join(
      home.credentialsDir,
      `.${randomUUID()}.credential.tmp`,
    );
    let handle;
    try {
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, filePath);
      await syncDirectoryBestEffort(home.credentialsDir);
    } catch {
      await handle?.close().catch(() => undefined);
      await unlink(temporaryPath).catch(() => undefined);
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
        await this.#removeStaleLock(lockPath);
        if (Date.now() >= deadline) {
          throw new NodeConfigurationStoreError(
            NODE_CONFIGURATION_STORE_FAILURE.lockTimeout,
            true,
          );
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
      }
    }
  }

  async #removeStaleLock(lockPath: string): Promise<void> {
    try {
      const lockStats = await stat(lockPath);
      if (Date.now() - lockStats.mtimeMs > this.#staleLockMs) {
        await unlink(lockPath).catch(() => undefined);
      }
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) {
        throw new NodeConfigurationStoreError(
          NODE_CONFIGURATION_STORE_FAILURE.credentialWriteFailed,
          true,
        );
      }
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

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
