/** Immutable canonical Novel Commit metadata returned by the application layer. */
import { captureNovelConversationId } from "../draft/index.js";
import {
  captureNovelCommitId,
  captureNovelDraftSessionId,
  captureNovelId,
  type NovelCommitId,
  type NovelDraftSessionId,
  type NovelId,
} from "../identity/index.js";
import { captureNovelRevision, captureNovelTimestamp, type NovelRevision, type NovelTimestamp } from "../version/index.js";
import { captureNovelChangeSetDigest, type NovelChangeSetDigest } from "./NovelChangeSetDigest.js";
import {
  captureNovelCommitPayloadDigest,
  captureNovelCommitPayloadRef,
  type NovelCommitPayloadDigest,
  type NovelCommitPayloadRef,
} from "./NovelCommitPayloadDigest.js";

export interface NovelCommit {
  readonly commitId: NovelCommitId;
  readonly novelId: NovelId;
  readonly draftSessionId: NovelDraftSessionId;
  readonly ownerConversationId: string;
  readonly baseRevision: NovelRevision;
  readonly resultRevision: NovelRevision;
  readonly changeSetDigest: NovelChangeSetDigest;
  readonly payloadRef: NovelCommitPayloadRef;
  readonly payloadDigest: NovelCommitPayloadDigest;
  readonly payloadSize: number;
  readonly committedAt: NovelTimestamp;
}

export function captureNovelCommit(value: NovelCommit): NovelCommit {
  if (!Number.isSafeInteger(value.payloadSize) || value.payloadSize < 0) {
    throw new TypeError("Novel Commit payload size is invalid");
  }
  return Object.freeze({
    commitId: captureNovelCommitId(value.commitId),
    novelId: captureNovelId(value.novelId),
    draftSessionId: captureNovelDraftSessionId(value.draftSessionId),
    ownerConversationId: captureNovelConversationId(value.ownerConversationId),
    baseRevision: captureNovelRevision(value.baseRevision),
    resultRevision: captureNovelRevision(value.resultRevision),
    changeSetDigest: captureNovelChangeSetDigest(value.changeSetDigest),
    payloadRef: captureNovelCommitPayloadRef(value.payloadRef),
    payloadDigest: captureNovelCommitPayloadDigest(value.payloadDigest),
    payloadSize: value.payloadSize,
    committedAt: captureNovelTimestamp(value.committedAt),
  });
}
