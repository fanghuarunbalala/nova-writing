/** Creates and validates durable Draft SQLite snapshots with node:sqlite backup. */
import {
  access,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import {
  NOVEL_SNAPSHOT_FAILURE,
  NovelSnapshotError,
  captureNovelConversationId,
  captureNovelDraftSession,
  captureNovelDraftSessionId,
  captureNovelId,
  captureNovelRevision,
  captureNovelTimestamp,
  type NovelDraftSession,
  type NovelDraftSessionId,
  type NovelDraftSnapshot,
  type NovelId,
  type ReplaceNovelDraftSnapshotInput,
  type CreateNovelRebaseCandidateSnapshotInput,
  type NovelSnapshotter,
} from "../../../novel/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import { syncDirectoryBestEffort } from "../../fs/index.js";
import type { NodeNovelStoreLocation } from "../workspace/index.js";
import {
  NOVEL_DATABASE_FAILURE,
  NovelDatabaseError,
} from "./NovelDatabaseErrors.js";
import { initializeNovelDraftSqliteSchema } from "./NovelDraftSqliteSchema.js";

const SNAPSHOT_MANIFEST_SCHEMA_VERSION = 1 as const;

interface SnapshotManifest {
  readonly schemaVersion: typeof SNAPSHOT_MANIFEST_SCHEMA_VERSION;
  readonly kind: "draft" | "rebase-candidate";
  readonly draftSessionId: NovelDraftSessionId;
  readonly novelId: NovelId;
  readonly ownerConversationId: string;
  readonly baseRevision: string;
  readonly sourceDraftSessionId?: NovelDraftSessionId;
  readonly replacedBaseRevision?: string;
}

export interface SqliteNovelSnapshotterOptions {
  readonly location: NodeNovelStoreLocation;
  readonly novelId: NovelId;
  readonly logger?: Logger;
}

export class SqliteNovelSnapshotter implements NovelSnapshotter {
  private readonly logger: Logger;
  private readonly novelId: NovelId;

  constructor(private readonly options: SqliteNovelSnapshotterOptions) {
    this.novelId = captureNovelId(options.novelId);
    this.logger = (options.logger ?? noopLogger).child({
      component: "sqlite_novel_snapshotter",
      workspaceId: options.location.workspaceId,
      novelId: this.novelId,
    });
  }

  async createDraftSnapshot(session: NovelDraftSession): Promise<void> {
    const captured = captureNovelDraftSession(session);
    await this.createSnapshot(captured, "draft");
  }

  async createRebaseCandidateSnapshot(
    input: CreateNovelRebaseCandidateSnapshotInput,
  ): Promise<void> {
    const captured = captureNovelDraftSession(input.session);
    const sourceDraftSessionId = captureNovelDraftSessionId(
      input.sourceDraftSessionId,
    );
    if (captured.id === sourceDraftSessionId) {
      throw new NovelSnapshotError(
        NOVEL_SNAPSHOT_FAILURE.invalid,
        captured.novelId,
        captured.id,
      );
    }
    await this.createSnapshot(
      captured,
      "rebase-candidate",
      sourceDraftSessionId,
    );
  }

  private async createSnapshot(
    captured: NovelDraftSession,
    kind: SnapshotManifest["kind"],
    sourceDraftSessionId?: NovelDraftSessionId,
  ): Promise<void> {
    this.assertNovelIdentity(captured.novelId);
    const paths = this.paths(captured.ownerConversationId, captured.id);
    const temporaryPaths = this.temporaryPaths(paths, captured.id);
    this.logger.info("novel_snapshot.create.started", {
      novelId: captured.novelId,
      draftSessionId: captured.id,
      ownerConversationId: captured.ownerConversationId,
      snapshotKind: kind,
    });
    try {
      await mkdir(paths.ownerDir, { recursive: true });
      if (await exists(paths.draftDir)) {
        throw new NovelSnapshotError(
          NOVEL_SNAPSHOT_FAILURE.alreadyExists,
          captured.novelId,
          captured.id,
        );
      }
      await mkdir(temporaryPaths.draftDir);
      await mkdir(temporaryPaths.artifactDir);
      await this.backupCanonical(captured, temporaryPaths.databasePath);
      await this.writeManifest(
        temporaryPaths,
        captured,
        undefined,
        kind,
        sourceDraftSessionId,
      );
      await syncFile(temporaryPaths.databasePath);
      await syncDirectory(temporaryPaths.draftDir);
      assertSnapshotDatabase(
        temporaryPaths.databasePath,
        captured,
      );
      await rename(temporaryPaths.draftDir, paths.draftDir);
      await syncDirectory(paths.ownerDir);
      this.logger.info("novel_snapshot.create.completed", {
        novelId: captured.novelId,
        draftSessionId: captured.id,
        ownerConversationId: captured.ownerConversationId,
        snapshotKind: kind,
      });
    } catch (error) {
      await rm(temporaryPaths.draftDir, { recursive: true, force: true }).catch(
        () => undefined,
      );
      if (error instanceof NovelSnapshotError) throw error;
      throw new NovelSnapshotError(
        NOVEL_SNAPSHOT_FAILURE.createFailed,
        captured.novelId,
        captured.id,
      );
    }
  }

  async replaceDraftSnapshot(
    input: ReplaceNovelDraftSnapshotInput,
  ): Promise<void> {
    const captured = captureNovelDraftSession(input.session);
    const expectedBaseRevision = captureNovelRevision(
      input.expectedBaseRevision,
    );
    this.assertNovelIdentity(captured.novelId);
    const paths = this.paths(captured.ownerConversationId, captured.id);
    if (!(await exists(paths.databasePath))) {
      throw new NovelSnapshotError(
        NOVEL_SNAPSHOT_FAILURE.missing,
        captured.novelId,
        captured.id,
      );
    }

    await rm(paths.nextDatabasePath, { force: true }).catch(() => undefined);
    await rm(paths.previousDatabasePath, { force: true }).catch(() => undefined);
    try {
      await this.backupCanonical(captured, paths.nextDatabasePath);
      await rename(paths.databasePath, paths.previousDatabasePath);
      await rename(paths.nextDatabasePath, paths.databasePath);
      await this.writeManifest(paths, captured, expectedBaseRevision);
      await rm(paths.previousDatabasePath, { force: true }).catch(
        () => undefined,
      );
      this.logger.info("novel_snapshot.replace.completed", {
        novelId: captured.novelId,
        draftSessionId: captured.id,
        ownerConversationId: captured.ownerConversationId,
      });
    } catch {
      if (await exists(paths.previousDatabasePath)) {
        await rm(paths.databasePath, { force: true }).catch(() => undefined);
        await rename(paths.previousDatabasePath, paths.databasePath).catch(
          () => undefined,
        );
      }
      await rm(paths.nextDatabasePath, { force: true }).catch(() => undefined);
      throw new NovelSnapshotError(
        NOVEL_SNAPSHOT_FAILURE.replaceFailed,
        captured.novelId,
        captured.id,
      );
    }
  }

  async inspectDraftSnapshot(
    novelId: NovelId,
    draftSessionId: NovelDraftSessionId,
  ): Promise<NovelDraftSnapshot | undefined> {
    const capturedNovelId = captureNovelId(novelId);
    this.assertNovelIdentity(capturedNovelId);
    const capturedDraftId = captureNovelDraftSessionId(draftSessionId);
    const discovered = await this.findDraftDirectory(capturedDraftId);
    if (discovered === undefined) return undefined;
    try {
      const manifest = await readManifest(discovered.manifestPath);
      if (
        manifest.novelId !== capturedNovelId ||
        manifest.draftSessionId !== capturedDraftId ||
        manifest.ownerConversationId !== discovered.ownerConversationId
      ) {
        throw new Error();
      }
      const snapshotSession = captureNovelDraftSession({
        id: manifest.draftSessionId,
        novelId: manifest.novelId,
        ownerConversationId: manifest.ownerConversationId,
        baseRevision: captureNovelRevision(manifest.baseRevision),
        status:
          manifest.kind === "rebase-candidate" ? "rebasing" : "active",
        createdAt: readDraftTimestamp(discovered.databasePath, "created_at"),
        updatedAt: readDraftTimestamp(discovered.databasePath, "updated_at"),
      });
      assertSnapshotDatabase(discovered.databasePath, snapshotSession);
      return Object.freeze({
        kind: manifest.kind,
        draftSessionId: manifest.draftSessionId,
        novelId: manifest.novelId,
        ownerConversationId: manifest.ownerConversationId,
        baseRevision: captureNovelRevision(manifest.baseRevision),
        ...(manifest.sourceDraftSessionId === undefined
          ? {}
          : { sourceDraftSessionId: manifest.sourceDraftSessionId }),
        ...(manifest.replacedBaseRevision === undefined
          ? {}
          : {
              replacedBaseRevision: captureNovelRevision(
                manifest.replacedBaseRevision,
              ),
            }),
      });
    } catch {
      throw new NovelSnapshotError(
        NOVEL_SNAPSHOT_FAILURE.invalid,
        capturedNovelId,
        capturedDraftId,
      );
    }
  }

  async listDraftSnapshotIds(
    novelId: NovelId,
  ): Promise<readonly NovelDraftSessionId[]> {
    const capturedNovelId = captureNovelId(novelId);
    this.assertNovelIdentity(capturedNovelId);
    const ids = new Set<NovelDraftSessionId>();
    for (const ownerEntry of await readDirectories(this.options.location.stagingDir)) {
      const ownerDir = join(this.options.location.stagingDir, ownerEntry.name);
      let removedTemporary = false;
      for (const draftEntry of await readDirectories(ownerDir)) {
        if (isSnapshotTemporaryDirectory(draftEntry.name)) {
          await rm(join(ownerDir, draftEntry.name), {
            recursive: true,
            force: true,
          });
          removedTemporary = true;
          continue;
        }
        try {
          const id = captureNovelDraftSessionId(draftEntry.name);
          ids.add(id);
        } catch {}
      }
      if (removedTemporary) await syncDirectory(ownerDir);
    }
    return Object.freeze([...ids].sort());
  }

  async removeDraftSnapshot(
    novelId: NovelId,
    draftSessionId: NovelDraftSessionId,
  ): Promise<void> {
    const capturedNovelId = captureNovelId(novelId);
    this.assertNovelIdentity(capturedNovelId);
    const capturedDraftId = captureNovelDraftSessionId(draftSessionId);
    const discovered = await this.findDraftDirectory(capturedDraftId);
    if (discovered === undefined) return;
    try {
      await rm(discovered.draftDir, { recursive: true, force: true });
      await rm(discovered.ownerDir).catch(() => undefined);
      this.logger.debug("novel_snapshot.remove.completed", {
        novelId: capturedNovelId,
        draftSessionId: capturedDraftId,
      });
    } catch {
      throw new NovelSnapshotError(
        NOVEL_SNAPSHOT_FAILURE.removeFailed,
        capturedNovelId,
        capturedDraftId,
      );
    }
  }

  private async backupCanonical(
    session: NovelDraftSession,
    targetPath: string,
  ): Promise<void> {
    const source = new DatabaseSync(
      this.options.location.canonicalDatabasePath,
      { readOnly: true },
    );
    try {
      assertSnapshotSource(source, session.novelId, session.baseRevision);
      await backup(source, targetPath);
    } finally {
      source.close();
    }
    assertCanonicalSnapshotDatabase(
      targetPath,
      session.novelId,
      session.baseRevision,
    );
    initializeNovelDraftSqliteSchema(targetPath, session);
    assertSnapshotDatabase(targetPath, session);
  }

  private async writeManifest(
    paths: SnapshotPaths,
    session: NovelDraftSession,
    replacedBaseRevision?: string,
    kind: SnapshotManifest["kind"] = "draft",
    sourceDraftSessionId?: NovelDraftSessionId,
  ): Promise<void> {
    const manifest: SnapshotManifest = Object.freeze({
      schemaVersion: SNAPSHOT_MANIFEST_SCHEMA_VERSION,
      kind,
      draftSessionId: session.id,
      novelId: session.novelId,
      ownerConversationId: session.ownerConversationId,
      baseRevision: session.baseRevision,
      ...(sourceDraftSessionId === undefined
        ? {}
        : {
            sourceDraftSessionId: captureNovelDraftSessionId(
              sourceDraftSessionId,
            ),
          }),
      ...(replacedBaseRevision === undefined
        ? {}
        : { replacedBaseRevision: captureNovelRevision(replacedBaseRevision) }),
    });
    await writeFile(paths.manifestTemporaryPath, `${JSON.stringify(manifest)}\n`, {
      encoding: "utf8",
      flag: "wx",
    }).catch(async () => {
      await rm(paths.manifestTemporaryPath, { force: true });
      await writeFile(
        paths.manifestTemporaryPath,
        `${JSON.stringify(manifest)}\n`,
        "utf8",
      );
    });
    await rename(paths.manifestTemporaryPath, paths.manifestPath);
    await syncFile(paths.manifestPath);
  }

  private async findDraftDirectory(
    draftSessionId: NovelDraftSessionId,
  ): Promise<DiscoveredSnapshot | undefined> {
    for (const ownerEntry of await readDirectories(this.options.location.stagingDir)) {
      const draftDir = join(
        this.options.location.stagingDir,
        ownerEntry.name,
        draftSessionId,
      );
      if (!(await exists(draftDir))) continue;
      return {
        ownerConversationId: ownerEntry.name,
        ownerDir: join(this.options.location.stagingDir, ownerEntry.name),
        draftDir,
        databasePath: join(draftDir, "draft.sqlite"),
        manifestPath: join(draftDir, "manifest.json"),
      };
    }
    return undefined;
  }

  private paths(
    ownerConversationId: string,
    draftSessionId: NovelDraftSessionId,
  ): SnapshotPaths {
    const ownerDir = join(
      this.options.location.stagingDir,
      captureNovelConversationId(ownerConversationId),
    );
    const draftDir = join(ownerDir, captureNovelDraftSessionId(draftSessionId));
    return {
      ownerConversationId,
      ownerDir,
      draftDir,
      databasePath: join(draftDir, "draft.sqlite"),
      nextDatabasePath: join(draftDir, "draft.next.sqlite"),
      previousDatabasePath: join(draftDir, "draft.previous.sqlite"),
      manifestPath: join(draftDir, "manifest.json"),
      manifestTemporaryPath: join(draftDir, "manifest.json.next"),
      artifactDir: join(draftDir, "artifacts"),
    };
  }

  private temporaryPaths(
    paths: SnapshotPaths,
    draftSessionId: NovelDraftSessionId,
  ): SnapshotPaths {
    const draftDir = join(
      paths.ownerDir,
      `.${captureNovelDraftSessionId(draftSessionId)}.${randomUUID()}.snapshot-tmp`,
    );
    return {
      ownerConversationId: paths.ownerConversationId,
      ownerDir: paths.ownerDir,
      draftDir,
      databasePath: join(draftDir, "draft.sqlite"),
      nextDatabasePath: join(draftDir, "draft.next.sqlite"),
      previousDatabasePath: join(draftDir, "draft.previous.sqlite"),
      manifestPath: join(draftDir, "manifest.json"),
      manifestTemporaryPath: join(draftDir, "manifest.json.next"),
      artifactDir: join(draftDir, "artifacts"),
    };
  }

  private assertNovelIdentity(novelId: NovelId): void {
    if (captureNovelId(novelId) !== this.novelId) {
      throw new NovelDatabaseError(
        NOVEL_DATABASE_FAILURE.novelMismatch,
        this.options.location.workspaceId,
        this.novelId,
      );
    }
  }
}

interface SnapshotPaths extends DiscoveredSnapshot {
  readonly ownerDir: string;
  readonly nextDatabasePath: string;
  readonly previousDatabasePath: string;
  readonly manifestTemporaryPath: string;
  readonly artifactDir: string;
}

interface DiscoveredSnapshot {
  readonly ownerConversationId: string;
  readonly ownerDir: string;
  readonly draftDir: string;
  readonly databasePath: string;
  readonly manifestPath: string;
}

function assertSnapshotSource(
  database: DatabaseSync,
  novelId: NovelId,
  revision: string,
): void {
  const row = database
    .prepare(
      `SELECT novel_id, current_revision
       FROM novel_metadata
       WHERE singleton = 1`,
    )
    .get() as { novel_id: string; current_revision: string } | undefined;
  if (
    row === undefined ||
    captureNovelId(row.novel_id) !== novelId ||
    captureNovelRevision(row.current_revision) !== revision
  ) {
    throw new Error();
  }
}

function assertSnapshotDatabase(
  path: string,
  session: NovelDraftSession,
): void {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    assertSnapshotSource(database, session.novelId, session.baseRevision);
    const draft = database
      .prepare(
        `SELECT draft_session_id, novel_id, owner_conversation_id,
                base_revision
         FROM draft_metadata WHERE singleton = 1`,
      )
      .get() as
      | {
          draft_session_id: string;
          novel_id: string;
          owner_conversation_id: string;
          base_revision: string;
        }
      | undefined;
    if (
      draft === undefined ||
      draft.draft_session_id !== session.id ||
      draft.novel_id !== session.novelId ||
      draft.owner_conversation_id !== session.ownerConversationId ||
      draft.base_revision !== session.baseRevision
    ) {
      throw new Error();
    }
    const integrity = database.prepare("PRAGMA integrity_check").get() as
      | { integrity_check?: unknown }
      | undefined;
    if (integrity?.integrity_check !== "ok") throw new Error();
  } finally {
    database.close();
  }
}

function assertCanonicalSnapshotDatabase(
  path: string,
  novelId: NovelId,
  revision: string,
): void {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    assertSnapshotSource(database, novelId, revision);
    const integrity = database.prepare("PRAGMA integrity_check").get() as
      | { integrity_check?: unknown }
      | undefined;
    if (integrity?.integrity_check !== "ok") throw new Error();
  } finally {
    database.close();
  }
}

async function readManifest(path: string): Promise<SnapshotManifest> {
  const value = JSON.parse(await readFile(path, "utf8")) as Partial<SnapshotManifest>;
  if (value.schemaVersion !== SNAPSHOT_MANIFEST_SCHEMA_VERSION) throw new Error();
  const kind =
    value.kind === undefined
      ? "draft"
      : value.kind === "draft" || value.kind === "rebase-candidate"
        ? value.kind
        : undefined;
  if (
    kind === undefined ||
    (kind === "draft" && value.sourceDraftSessionId !== undefined) ||
    (kind === "rebase-candidate" && value.sourceDraftSessionId === undefined)
  ) {
    throw new Error();
  }
  return Object.freeze({
    schemaVersion: SNAPSHOT_MANIFEST_SCHEMA_VERSION,
    kind,
    draftSessionId: captureNovelDraftSessionId(value.draftSessionId),
    novelId: captureNovelId(value.novelId),
    ownerConversationId: captureNovelConversationId(value.ownerConversationId),
    baseRevision: captureNovelRevision(value.baseRevision),
    ...(value.sourceDraftSessionId === undefined
      ? {}
      : {
          sourceDraftSessionId: captureNovelDraftSessionId(
            value.sourceDraftSessionId,
          ),
        }),
    ...(value.replacedBaseRevision === undefined
      ? {}
      : {
          replacedBaseRevision: captureNovelRevision(
            value.replacedBaseRevision,
          ),
        }),
  });
}

function readDraftTimestamp(
  path: string,
  column: "created_at" | "updated_at",
) {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const row = database
      .prepare(`SELECT ${column} AS value FROM draft_metadata WHERE singleton = 1`)
      .get() as { value: string } | undefined;
    if (row === undefined) throw new Error();
    return captureNovelTimestamp(row.value);
  } finally {
    database.close();
  }
}

function isSnapshotTemporaryDirectory(name: string): boolean {
  return /^\.[A-Za-z0-9][A-Za-z0-9._:-]{0,159}\.[0-9a-f-]{36}\.snapshot-tmp$/u.test(
    name,
  );
}

async function syncFile(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(path: string): Promise<void> {
  await syncDirectoryBestEffort(path);
}

async function readDirectories(path: string) {
  try {
    return (await readdir(path, { withFileTypes: true })).filter((entry) =>
      entry.isDirectory(),
    );
  } catch {
    return [];
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
