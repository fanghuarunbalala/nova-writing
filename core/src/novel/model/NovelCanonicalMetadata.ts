/** Immutable canonical Novel identity and revision metadata exposed without paths. */
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../error/index.js";
import { captureNovelId, type NovelId } from "../identity/index.js";
import {
  captureNovelRevision,
  captureNovelSchemaVersion,
  captureNovelTimestamp,
  type NovelRevision,
  type NovelSchemaVersion,
  type NovelTimestamp,
} from "../version/index.js";

export interface NovelCanonicalMetadata {
  readonly novelId: NovelId;
  readonly workspaceId: string;
  readonly schemaVersion: NovelSchemaVersion;
  readonly currentRevision: NovelRevision;
  readonly createdAt: NovelTimestamp;
  readonly updatedAt: NovelTimestamp;
}

export function captureNovelCanonicalMetadata(
  value: NovelCanonicalMetadata,
): NovelCanonicalMetadata {
  return Object.freeze({
    novelId: captureNovelId(value.novelId),
    workspaceId: captureNovelWorkspaceId(value.workspaceId),
    schemaVersion: captureNovelSchemaVersion(value.schemaVersion),
    currentRevision: captureNovelRevision(value.currentRevision),
    createdAt: captureNovelTimestamp(value.createdAt),
    updatedAt: captureNovelTimestamp(value.updatedAt),
  });
}

export function captureNovelWorkspaceId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(value)
  ) {
    throw new NovelProtocolValidationError(
      NOVEL_PROTOCOL_FAILURE.invalidIdentity,
      "workspaceId",
    );
  }
  return value;
}
