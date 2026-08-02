/** Compile-only proof that Novel infrastructure identities remain non-interchangeable. */
import type {
  NovelCommitId,
  NovelDraftSessionId,
  NovelEntityVersion,
  NovelId,
  NovelRevision,
  NovelSchemaVersion,
} from "../src/novel/index.js";

declare const novelId: NovelId;
declare const commitId: NovelCommitId;
declare const draftSessionId: NovelDraftSessionId;
declare const revision: NovelRevision;
declare const schemaVersion: NovelSchemaVersion;
declare const entityVersion: NovelEntityVersion;

const validNovelId: NovelId = novelId;
const validCommitId: NovelCommitId = commitId;
const validDraftSessionId: NovelDraftSessionId = draftSessionId;
const validRevision: NovelRevision = revision;
const validSchemaVersion: NovelSchemaVersion = schemaVersion;
const validEntityVersion: NovelEntityVersion = entityVersion;

// @ts-expect-error A Commit ID cannot be used as a Novel ID.
const invalidNovelId: NovelId = commitId;
// @ts-expect-error A Draft Session ID cannot be used as a Commit ID.
const invalidCommitId: NovelCommitId = draftSessionId;
// @ts-expect-error Schema and entity versions have separate meanings.
const invalidEntityVersion: NovelEntityVersion = schemaVersion;

void validNovelId;
void validCommitId;
void validDraftSessionId;
void validRevision;
void validSchemaVersion;
void validEntityVersion;
void invalidNovelId;
void invalidCommitId;
void invalidEntityVersion;
