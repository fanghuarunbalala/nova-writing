/** Fixed Novel SQLite failures without paths, SQL, content, or raw driver errors. */
import {
  captureNovelId,
  captureNovelWorkspaceId,
  type NovelId,
} from "../../../novel/index.js";

export const NOVEL_DATABASE_FAILURE = {
  workspaceMismatch: "workspace_mismatch",
  novelMismatch: "novel_mismatch",
  unsupportedSchema: "unsupported_schema",
  invalidStructure: "invalid_structure",
  closed: "closed",
} as const;

export type NovelDatabaseFailure =
  (typeof NOVEL_DATABASE_FAILURE)[keyof typeof NOVEL_DATABASE_FAILURE];

export class NovelDatabaseError extends Error {
  override readonly name = "NovelDatabaseError";
  readonly code = "NOVEL_DATABASE_FAILED" as const;
  readonly workspaceId?: string;
  readonly novelId?: NovelId;

  constructor(
    public readonly failure: NovelDatabaseFailure,
    workspaceId?: string,
    novelId?: NovelId,
  ) {
    super("Novel database operation failed");
    this.workspaceId = captureSafeWorkspaceId(workspaceId);
    this.novelId = captureSafeNovelId(novelId);
  }
}

function captureSafeWorkspaceId(value: unknown): string | undefined {
  try {
    return value === undefined ? undefined : captureNovelWorkspaceId(value);
  } catch {
    return undefined;
  }
}

function captureSafeNovelId(value: unknown): NovelId | undefined {
  try {
    return value === undefined ? undefined : captureNovelId(value);
  } catch {
    return undefined;
  }
}
