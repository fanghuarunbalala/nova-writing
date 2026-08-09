/**
 * Compose 审计记录存储：批准后将 design 草稿的一次提交写入 novel.sqlite。
 * Compose audit store: persists one approved design commit into novel.sqlite.
 */
import { DatabaseSync } from "node:sqlite";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { NodeNovelStoreLocation } from "../workspace/index.js";
import type { NovelId } from "../../../novel/index.js";
import { captureNovelId } from "../../../novel/index.js";

export interface NovelComposeCommitInput {
  readonly designId: string;
  readonly conversationId: string;
  readonly approvedAt: string;
  readonly revisionBase?: string;
  readonly contentDigest: string;
  readonly archivePath: string;
}

export interface SqliteNovelComposeCommitStoreOptions {
  readonly location: NodeNovelStoreLocation;
  readonly novelId: NovelId;
  readonly logger?: Logger;
}

/** 把一次已批准的 compose 提交写入 novel_compose_commits。 */
/** Persists one approved compose commit into novel_compose_commits. */
export class SqliteNovelComposeCommitStore {
  readonly #location: NodeNovelStoreLocation;
  readonly #novelId: string;
  readonly #logger: Logger;

  constructor(options: SqliteNovelComposeCommitStoreOptions) {
    this.#location = options.location;
    this.#novelId = captureNovelId(options.novelId);
    this.#logger = (options.logger ?? noopLogger).child({
      component: "sqlite_novel_compose_commit_store",
      workspaceId: options.location.workspaceId,
      novelId: this.#novelId,
    });
  }

  /** 记录一次提交。Records one commit. */
  async record(input: NovelComposeCommitInput): Promise<void> {
    const database = new DatabaseSync(this.#location.canonicalDatabasePath);
    try {
      database.exec("PRAGMA journal_mode = WAL");
      database.exec("PRAGMA busy_timeout = 5000");
      const createdAt = new Date().toISOString();
      database
        .prepare(
          `INSERT INTO novel_compose_commits (
             design_id, conversation_id, novel_id, approved_at, revision_base,
             content_digest, archive_path, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.designId,
          input.conversationId,
          this.#novelId,
          input.approvedAt,
          input.revisionBase ?? null,
          input.contentDigest,
          input.archivePath,
          createdAt,
        );
      this.#logger.info("novel_compose_commit.recorded", {
        designId: input.designId,
        conversationId: input.conversationId,
      });
    } finally {
      database.close();
    }
  }
}
