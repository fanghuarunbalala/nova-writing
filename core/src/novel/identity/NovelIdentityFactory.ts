/** Generates collision-resistant Novel infrastructure IDs behind an injectable port. */
import {
  captureNovelArtifactId,
  captureNovelCommitId,
  captureNovelConflictId,
  captureNovelDraftSessionId,
  captureNovelId,
  captureNovelOperationId,
  type NovelArtifactId,
  type NovelCommitId,
  type NovelConflictId,
  type NovelDraftSessionId,
  type NovelId,
  type NovelOperationId,
} from "./NovelIdentity.js";

export interface NovelIdentityFactory {
  createNovelId(): NovelId;
  createDraftSessionId(): NovelDraftSessionId;
  createOperationId(): NovelOperationId;
  createCommitId(): NovelCommitId;
  createConflictId(): NovelConflictId;
  createArtifactId(): NovelArtifactId;
}

export class RandomNovelIdentityFactory implements NovelIdentityFactory {
  createNovelId(): NovelId {
    return captureNovelId(createRandomIdentity("novel"));
  }

  createDraftSessionId(): NovelDraftSessionId {
    return captureNovelDraftSessionId(createRandomIdentity("draft"));
  }

  createOperationId(): NovelOperationId {
    return captureNovelOperationId(createRandomIdentity("operation"));
  }

  createCommitId(): NovelCommitId {
    return captureNovelCommitId(createRandomIdentity("commit"));
  }

  createConflictId(): NovelConflictId {
    return captureNovelConflictId(createRandomIdentity("conflict"));
  }

  createArtifactId(): NovelArtifactId {
    return captureNovelArtifactId(createRandomIdentity("artifact"));
  }
}

function createRandomIdentity(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
}
