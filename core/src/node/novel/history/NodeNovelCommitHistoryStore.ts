/** Node filesystem adapter for atomic immutable Novel Commit payload files. */
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  NovelCommitHistoryIntegrityError,
  NovelCommitPayloadIdentityConflictError,
  canonicalizeNovelCommitPayload,
  captureNovelCommitId,
  captureNovelCommitPayload,
  captureNovelCommitPayloadDigest,
  captureNovelCommitPayloadRef,
  commitPayloadRef,
  type NovelCommitHistoryReference,
  type NovelCommitHistoryReconciliationResult,
  type NovelCommitHistoryStore,
  type NovelCommitPayload,
  type NovelCommitPayloadDigest,
  type PreparedNovelCommitPayload,
} from "../../../novel/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import { syncDirectoryBestEffort } from "../../fs/index.js";
import type { NodeNovelStoreLocation } from "../workspace/index.js";

export interface NodeNovelCommitHistoryStoreOptions {
  readonly location: NodeNovelStoreLocation;
  readonly logger?: Logger;
}

export class NodeNovelCommitHistoryStore implements NovelCommitHistoryStore {
  private readonly logger: Logger;

  constructor(private readonly options: NodeNovelCommitHistoryStoreOptions) {
    this.logger = (options.logger ?? noopLogger).child({
      component: "node_novel_commit_history_store",
      workspaceId: options.location.workspaceId,
    });
  }

  async prepare(payloadInput: NovelCommitPayload): Promise<PreparedNovelCommitPayload> {
    const payload = captureNovelCommitPayload(payloadInput);
    const payloadRef = commitPayloadRef(payload.commitId);
    const bytes = Buffer.from(canonicalizeNovelCommitPayload(payload), "utf8");
    const payloadDigest = digest(bytes);
    const prepared = captureReference({
      commitId: payload.commitId,
      payloadRef,
      payloadDigest,
      payloadSize: bytes.byteLength,
    });
    await mkdir(this.options.location.commitHistoryDir, { recursive: true });
    if (await exists(this.path(payloadRef))) {
      await this.verifyBytes(prepared, bytes, true);
      return prepared;
    }

    const temporaryName = `.${payload.commitId}.${randomUUID()}.tmp`;
    const temporaryPath = join(this.options.location.commitHistoryDir, temporaryName);
    let handle;
    try {
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, this.path(payloadRef));
      await syncDirectory(this.options.location.commitHistoryDir);
      await this.verifyBytes(prepared, bytes, true);
      this.logger.info("novel_commit_payload.prepared", {
        commitId: payload.commitId,
        payloadSize: prepared.payloadSize,
      });
      return prepared;
    } catch (error) {
      try { await handle?.close(); } catch {}
      try { await unlink(temporaryPath); } catch {}
      if (
        error instanceof NovelCommitPayloadIdentityConflictError ||
        error instanceof NovelCommitHistoryIntegrityError
      ) throw error;
      throw new NovelCommitHistoryIntegrityError(payload.commitId);
    }
  }

  async verify(referenceInput: NovelCommitHistoryReference): Promise<void> {
    const reference = captureReference(referenceInput);
    await this.verifyBytes(reference, undefined, false);
  }

  async reconcile(
    referenceInputs: readonly NovelCommitHistoryReference[],
  ): Promise<NovelCommitHistoryReconciliationResult> {
    const references = referenceInputs.map(captureReference);
    const referenced = new Map(references.map((value) => [value.payloadRef, value]));
    await mkdir(this.options.location.commitHistoryDir, { recursive: true });
    let removedTemporaryCount = 0;
    let removedOrphanCount = 0;
    for (const entry of await readdir(this.options.location.commitHistoryDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (isTemporary(entry.name)) {
        await unlink(join(this.options.location.commitHistoryDir, entry.name));
        removedTemporaryCount += 1;
        continue;
      }
      if (isPayloadRef(entry.name)) {
        const payloadRef = captureNovelCommitPayloadRef(entry.name);
        if (!referenced.has(payloadRef)) {
          await unlink(join(this.options.location.commitHistoryDir, entry.name));
          removedOrphanCount += 1;
        }
      }
    }
    if (removedTemporaryCount + removedOrphanCount > 0) {
      await syncDirectory(this.options.location.commitHistoryDir);
    }
    const missing = [];
    for (const reference of references) {
      if (!(await exists(this.path(reference.payloadRef)))) {
        missing.push(reference);
        continue;
      }
      await this.verify(reference);
    }
    this.logger.info("novel_commit_history.reconciled", {
      referenceCount: references.length,
      removedTemporaryCount,
      removedOrphanCount,
      missingCount: missing.length,
    });
    return Object.freeze({
      removedTemporaryCount,
      removedOrphanCount,
      missing: Object.freeze(missing),
    });
  }

  private path(payloadRef: string): string {
    return join(
      this.options.location.commitHistoryDir,
      captureNovelCommitPayloadRef(payloadRef),
    );
  }

  private async verifyBytes(
    reference: NovelCommitHistoryReference,
    expectedBytes: Buffer | undefined,
    identityConflict: boolean,
  ): Promise<void> {
    try {
      const filePath = this.path(reference.payloadRef);
      const metadata = await lstat(filePath);
      if (!metadata.isFile() || metadata.size !== reference.payloadSize) throw new Error();
      const bytes = await readFile(filePath);
      if (
        digest(bytes) !== reference.payloadDigest ||
        (expectedBytes !== undefined && !bytes.equals(expectedBytes))
      ) throw new Error();
    } catch {
      if (identityConflict) {
        throw new NovelCommitPayloadIdentityConflictError(reference.commitId);
      }
      throw new NovelCommitHistoryIntegrityError(reference.commitId);
    }
  }
}

function captureReference(
  value: NovelCommitHistoryReference,
): PreparedNovelCommitPayload {
  if (!Number.isSafeInteger(value.payloadSize) || value.payloadSize < 0) {
    throw new NovelCommitHistoryIntegrityError(captureNovelCommitId(value.commitId));
  }
  return Object.freeze({
    commitId: captureNovelCommitId(value.commitId),
    payloadRef: captureNovelCommitPayloadRef(value.payloadRef),
    payloadDigest: captureNovelCommitPayloadDigest(value.payloadDigest),
    payloadSize: value.payloadSize,
  });
}

function digest(bytes: Buffer): NovelCommitPayloadDigest {
  const hex = createHash("sha256").update(bytes).digest("hex");
  return captureNovelCommitPayloadDigest(`sha256:${hex}`);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error &&
      error.code === "ENOENT" ? false : Promise.reject(error);
  }
}

async function syncDirectory(directory: string): Promise<void> {
  await syncDirectoryBestEffort(directory);
}

function isTemporary(name: string): boolean {
  return /^\.[A-Za-z0-9][A-Za-z0-9._:-]{0,159}\.[0-9a-f-]+\.tmp$/u.test(name);
}

function isPayloadRef(name: string): boolean {
  try {
    captureNovelCommitPayloadRef(name);
    return true;
  } catch {
    return false;
  }
}
