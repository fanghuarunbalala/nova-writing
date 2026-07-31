import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type {
  WorkspaceStoreLocation,
  WorkspaceStoreLocator,
  WorkspaceStoreNamingStrategy,
} from "../../storage/workspace/index.js";
import { SemanticWorkspaceStoreNamingStrategy } from "./SemanticWorkspaceStoreNamingStrategy.js";
import {
  WorkspaceIndexLockTimeoutError,
  WorkspaceRootAlreadyBoundError,
  WorkspaceStoreIndexError,
  WorkspaceStoreNotFoundError,
} from "./WorkspaceStoreErrors.js";

const WORKSPACE_INDEX_SCHEMA_VERSION = 1;
const WORKSPACE_DESCRIPTOR_SCHEMA_VERSION = 1;

interface WorkspaceIndexEntry {
  workspaceId: string;
  workspaceRoot: string;
  storeDirName: string;
  createdAt: string;
  updatedAt: string;
}

interface WorkspaceIndexFile {
  schemaVersion: number;
  workspaces: WorkspaceIndexEntry[];
}

interface WorkspaceDescriptorFile extends WorkspaceIndexEntry {
  schemaVersion: number;
}

export interface NodeWorkspaceStoreLocatorOptions {
  storageRoot: string;
  namingStrategy?: WorkspaceStoreNamingStrategy;
  lockTimeoutMs?: number;
  staleLockMs?: number;
}

export class NodeWorkspaceStoreLocator implements WorkspaceStoreLocator {
  private readonly storageRoot: string;
  private readonly workspacesRoot: string;
  private readonly indexPath: string;
  private readonly lockPath: string;
  private readonly namingStrategy: WorkspaceStoreNamingStrategy;
  private readonly lockTimeoutMs: number;
  private readonly staleLockMs: number;

  constructor(options: NodeWorkspaceStoreLocatorOptions) {
    this.storageRoot = resolve(options.storageRoot);
    this.workspacesRoot = join(this.storageRoot, "workspaces");
    this.indexPath = join(this.storageRoot, "workspace-index.json");
    this.lockPath = join(this.storageRoot, ".workspace-index.lock");
    this.namingStrategy = options.namingStrategy ?? new SemanticWorkspaceStoreNamingStrategy();
    this.lockTimeoutMs = options.lockTimeoutMs ?? 5_000;
    this.staleLockMs = options.staleLockMs ?? 30_000;
  }

  async resolve(workspaceRoot: string): Promise<WorkspaceStoreLocation> {
    const canonicalWorkspaceRoot = await this.canonicalizeWorkspaceRoot(workspaceRoot);

    return this.withIndexLock(async () => {
      const index = await this.readIndex();
      const existing = index.workspaces.find(
        (entry) => entry.workspaceRoot === canonicalWorkspaceRoot,
      );

      if (existing !== undefined) {
        await this.validateExistingWorkspaceStore(existing);
        return this.toLocation(existing);
      }

      const createdAt = new Date().toISOString();
      const workspaceId = `ws-${randomUUID()}`;
      const storeDirName = this.namingStrategy.createStoreDirName({
        canonicalWorkspaceRoot,
        workspaceId,
      });
      const entry: WorkspaceIndexEntry = {
        workspaceId,
        workspaceRoot: canonicalWorkspaceRoot,
        storeDirName: await this.ensureUniqueStoreDirName(storeDirName, workspaceId, index),
        createdAt,
        updatedAt: createdAt,
      };

      await this.initializeWorkspaceStore(entry);
      index.workspaces.push(entry);
      await this.writeIndex(index);

      return this.toLocation(entry);
    });
  }

  async getByWorkspaceId(workspaceId: string): Promise<WorkspaceStoreLocation | undefined> {
    const index = await this.readIndex();
    const entry = index.workspaces.find((workspace) => workspace.workspaceId === workspaceId);
    return entry === undefined ? undefined : this.toLocation(entry);
  }

  async rebind(workspaceId: string, newWorkspaceRoot: string): Promise<WorkspaceStoreLocation> {
    const canonicalWorkspaceRoot = await this.canonicalizeWorkspaceRoot(newWorkspaceRoot);

    return this.withIndexLock(async () => {
      const index = await this.readIndex();
      const entry = index.workspaces.find((workspace) => workspace.workspaceId === workspaceId);
      if (entry === undefined) throw new WorkspaceStoreNotFoundError(workspaceId);

      const conflictingEntry = index.workspaces.find(
        (workspace) =>
          workspace.workspaceRoot === canonicalWorkspaceRoot && workspace.workspaceId !== workspaceId,
      );
      if (conflictingEntry !== undefined) {
        throw new WorkspaceRootAlreadyBoundError(
          canonicalWorkspaceRoot,
          conflictingEntry.workspaceId,
        );
      }

      const previousWorkspaceRoot = entry.workspaceRoot;
      const previousUpdatedAt = entry.updatedAt;
      entry.workspaceRoot = canonicalWorkspaceRoot;
      entry.updatedAt = new Date().toISOString();

      try {
        await this.writeWorkspaceDescriptor(entry);
        await this.writeIndex(index);
      } catch (error) {
        entry.workspaceRoot = previousWorkspaceRoot;
        entry.updatedAt = previousUpdatedAt;
        await this.writeWorkspaceDescriptor(entry).catch(() => undefined);
        throw error;
      }

      return this.toLocation(entry);
    });
  }

  private async canonicalizeWorkspaceRoot(workspaceRoot: string): Promise<string> {
    const resolvedRoot = resolve(workspaceRoot);
    const workspaceStats = await stat(resolvedRoot);
    if (!workspaceStats.isDirectory()) {
      throw new WorkspaceStoreIndexError(`Workspace root is not a directory: ${resolvedRoot}`);
    }

    return realpath(resolvedRoot);
  }

  private async initializeWorkspaceStore(entry: WorkspaceIndexEntry): Promise<void> {
    const storeDir = join(this.workspacesRoot, entry.storeDirName);
    await mkdir(join(storeDir, "conversations"), { recursive: true });
    await this.writeWorkspaceDescriptor(entry);
  }

  private async ensureUniqueStoreDirName(
    preferredName: string,
    workspaceId: string,
    index: WorkspaceIndexFile,
  ): Promise<string> {
    if (
      !index.workspaces.some((entry) => entry.storeDirName === preferredName) &&
      !(await this.storeDirExists(preferredName))
    ) {
      return preferredName;
    }

    const compactId = workspaceId.replace(/^ws-/u, "").replace(/-/gu, "");
    for (const suffixLength of [12, 16, 24, compactId.length]) {
      const candidate = preferredName.replace(/--[^-]+$/u, `--${compactId.slice(0, suffixLength)}`);
      if (
        !index.workspaces.some((entry) => entry.storeDirName === candidate) &&
        !(await this.storeDirExists(candidate))
      ) {
        return candidate;
      }
    }

    throw new WorkspaceStoreIndexError(`Unable to allocate a unique store directory for ${workspaceId}`);
  }

  private async readIndex(): Promise<WorkspaceIndexFile> {
    await mkdir(this.storageRoot, { recursive: true });

    let contents: string;
    try {
      contents = await readFile(this.indexPath, "utf8");
    } catch (error) {
      if (this.isNodeError(error, "ENOENT")) {
        return { schemaVersion: WORKSPACE_INDEX_SCHEMA_VERSION, workspaces: [] };
      }
      throw error;
    }

    try {
      const parsed = JSON.parse(contents) as Partial<WorkspaceIndexFile>;
      if (
        parsed.schemaVersion !== WORKSPACE_INDEX_SCHEMA_VERSION ||
        !Array.isArray(parsed.workspaces)
      ) {
        throw new WorkspaceStoreIndexError(`Unsupported workspace index: ${this.indexPath}`);
      }
      return parsed as WorkspaceIndexFile;
    } catch (error) {
      if (error instanceof WorkspaceStoreIndexError) throw error;
      throw new WorkspaceStoreIndexError(`Invalid workspace index JSON: ${this.indexPath}`, {
        cause: error,
      });
    }
  }

  private async writeIndex(index: WorkspaceIndexFile): Promise<void> {
    await this.writeJsonAtomically(this.indexPath, index);
  }

  private async writeWorkspaceDescriptor(entry: WorkspaceIndexEntry): Promise<void> {
    const descriptor: WorkspaceDescriptorFile = {
      schemaVersion: WORKSPACE_DESCRIPTOR_SCHEMA_VERSION,
      ...entry,
    };
    const descriptorPath = join(this.workspacesRoot, entry.storeDirName, "workspace.json");
    await this.writeJsonAtomically(descriptorPath, descriptor);
  }

  private async validateExistingWorkspaceStore(entry: WorkspaceIndexEntry): Promise<void> {
    const descriptorPath = join(this.workspacesRoot, entry.storeDirName, "workspace.json");
    let contents: string;
    try {
      contents = await readFile(descriptorPath, "utf8");
    } catch (error) {
      throw new WorkspaceStoreIndexError(
        `Workspace descriptor is missing or unreadable: ${descriptorPath}`,
        { cause: error },
      );
    }

    try {
      const descriptor = JSON.parse(contents) as Partial<WorkspaceDescriptorFile>;
      if (
        descriptor.schemaVersion !== WORKSPACE_DESCRIPTOR_SCHEMA_VERSION ||
        descriptor.workspaceId !== entry.workspaceId ||
        descriptor.workspaceRoot !== entry.workspaceRoot ||
        descriptor.storeDirName !== entry.storeDirName
      ) {
        throw new WorkspaceStoreIndexError(
          `Workspace descriptor does not match the index: ${descriptorPath}`,
        );
      }
    } catch (error) {
      if (error instanceof WorkspaceStoreIndexError) throw error;
      throw new WorkspaceStoreIndexError(`Invalid workspace descriptor JSON: ${descriptorPath}`, {
        cause: error,
      });
    }
  }

  private async storeDirExists(storeDirName: string): Promise<boolean> {
    try {
      await stat(join(this.workspacesRoot, storeDirName));
      return true;
    } catch (error) {
      if (this.isNodeError(error, "ENOENT")) return false;
      throw error;
    }
  }

  private async writeJsonAtomically(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporaryPath, path);
  }

  private toLocation(entry: WorkspaceIndexEntry): WorkspaceStoreLocation {
    const storeDir = join(this.workspacesRoot, entry.storeDirName);
    return {
      ...entry,
      storeDir,
      databasePath: join(storeDir, "novel.db"),
    };
  }

  private async withIndexLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(this.storageRoot, { recursive: true });
    const deadline = Date.now() + this.lockTimeoutMs;

    while (true) {
      try {
        const handle = await open(this.lockPath, "wx");
        try {
          await handle.writeFile(
            JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
            "utf8",
          );
          return await operation();
        } finally {
          await handle.close();
          await unlink(this.lockPath).catch(() => undefined);
        }
      } catch (error) {
        if (!this.isNodeError(error, "EEXIST")) throw error;
        await this.removeStaleLock();
        if (Date.now() >= deadline) throw new WorkspaceIndexLockTimeoutError(this.lockPath);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
      }
    }
  }

  private async removeStaleLock(): Promise<void> {
    try {
      const lockStats = await stat(this.lockPath);
      if (Date.now() - lockStats.mtimeMs > this.staleLockMs) {
        await unlink(this.lockPath).catch(() => undefined);
      }
    } catch (error) {
      if (!this.isNodeError(error, "ENOENT")) throw error;
    }
  }

  private isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error && error.code === code;
  }
}
