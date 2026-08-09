/** Internal locked, revision-aware, atomically replaced JSON Configuration file. */
import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { syncDirectoryBestEffort } from "../fs/syncDirectory.js";
import {
  NODE_CONFIGURATION_STORE_FAILURE,
  NodeConfigurationStoreError,
} from "./NodeConfigurationStoreErrors.js";

interface RevisionedConfigurationSnapshot {
  readonly revision: number;
}

export interface AtomicJsonConfigurationFileOptions<TConfiguration> {
  readonly filePath: string;
  readonly hydrate: (snapshot: unknown) => TConfiguration;
  readonly snapshot: (
    configuration: TConfiguration,
  ) => RevisionedConfigurationSnapshot;
  readonly lockTimeoutMs?: number;
  readonly staleLockMs?: number;
}

export class AtomicJsonConfigurationFile<TConfiguration> {
  readonly #filePath: string;
  readonly #lockPath: string;
  readonly #hydrate: (snapshot: unknown) => TConfiguration;
  readonly #snapshot: (
    configuration: TConfiguration,
  ) => RevisionedConfigurationSnapshot;
  readonly #lockTimeoutMs: number;
  readonly #staleLockMs: number;

  constructor(options: AtomicJsonConfigurationFileOptions<TConfiguration>) {
    this.#filePath = options.filePath;
    this.#lockPath = join(
      dirname(options.filePath),
      `.${basename(options.filePath)}.lock`,
    );
    this.#hydrate = options.hydrate;
    this.#snapshot = options.snapshot;
    this.#lockTimeoutMs = options.lockTimeoutMs ?? 5_000;
    this.#staleLockMs = options.staleLockMs ?? 30_000;
  }

  async load(): Promise<TConfiguration | undefined> {
    return this.#loadUnlocked();
  }

  async save(
    configuration: TConfiguration,
    expectedRevision?: number,
  ): Promise<void> {
    await this.#withLock(async () => {
      const existing = await this.#loadUnlocked();
      const nextSnapshot = this.#snapshot(configuration);
      const currentRevision = existing === undefined
        ? undefined
        : this.#snapshot(existing).revision;
      this.#assertRevision(currentRevision, nextSnapshot.revision, expectedRevision);
      await this.#writeAtomically(nextSnapshot);
    });
  }

  async #loadUnlocked(): Promise<TConfiguration | undefined> {
    let contents: string;
    try {
      contents = await readFile(this.#filePath, "utf8");
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return undefined;
      throw new NodeConfigurationStoreError(
        NODE_CONFIGURATION_STORE_FAILURE.readFailed,
        true,
      );
    }
    try {
      return this.#hydrate(JSON.parse(contents));
    } catch {
      throw new NodeConfigurationStoreError(
        NODE_CONFIGURATION_STORE_FAILURE.invalidDocument,
      );
    }
  }

  #assertRevision(
    currentRevision: number | undefined,
    nextRevision: number,
    expectedRevision: number | undefined,
  ): void {
    if (expectedRevision !== undefined && currentRevision !== expectedRevision) {
      throw new NodeConfigurationStoreError(
        NODE_CONFIGURATION_STORE_FAILURE.revisionConflict,
        true,
      );
    }
    if (currentRevision === undefined) {
      if (nextRevision !== 0) {
        throw new NodeConfigurationStoreError(
          NODE_CONFIGURATION_STORE_FAILURE.revisionConflict,
          true,
        );
      }
      return;
    }
    if (nextRevision !== currentRevision + 1) {
      throw new NodeConfigurationStoreError(
        NODE_CONFIGURATION_STORE_FAILURE.revisionConflict,
        true,
      );
    }
  }

  async #writeAtomically(snapshot: RevisionedConfigurationSnapshot): Promise<void> {
    const directory = dirname(this.#filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporaryPath = join(
      directory,
      `.${basename(this.#filePath)}.${randomUUID()}.tmp`,
    );
    let handle;
    try {
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, this.#filePath);
      await syncDirectoryBestEffort(directory);
    } catch {
      await handle?.close().catch(() => undefined);
      await unlink(temporaryPath).catch(() => undefined);
      throw new NodeConfigurationStoreError(
        NODE_CONFIGURATION_STORE_FAILURE.writeFailed,
        true,
      );
    }
  }

  async #withLock<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
    await mkdir(dirname(this.#lockPath), { recursive: true, mode: 0o700 });
    const deadline = Date.now() + this.#lockTimeoutMs;
    while (true) {
      try {
        const handle = await open(this.#lockPath, "wx", 0o600);
        try {
          await handle.writeFile(
            JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
            "utf8",
          );
          await handle.sync();
          return await operation();
        } finally {
          await handle.close();
          await unlink(this.#lockPath).catch(() => undefined);
        }
      } catch (error) {
        if (error instanceof NodeConfigurationStoreError) throw error;
        if (!isNodeError(error, "EEXIST")) {
          throw new NodeConfigurationStoreError(
            NODE_CONFIGURATION_STORE_FAILURE.writeFailed,
            true,
          );
        }
        await this.#removeStaleLock();
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

  async #removeStaleLock(): Promise<void> {
    try {
      const lockStats = await stat(this.#lockPath);
      if (Date.now() - lockStats.mtimeMs > this.#staleLockMs) {
        await unlink(this.#lockPath).catch(() => undefined);
      }
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) {
        throw new NodeConfigurationStoreError(
          NODE_CONFIGURATION_STORE_FAILURE.writeFailed,
          true,
        );
      }
    }
  }
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
