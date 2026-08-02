import assert from "node:assert/strict";
import {
  NOVEL_INVARIANT_FAILURE,
  NOVEL_PROTOCOL_FAILURE,
  NovelDraftSessionNotFoundError,
  NovelDraftSessionStateError,
  NovelInvariantViolationError,
  NovelProtocolValidationError,
  NovelRevisionConflictError,
  RandomNovelIdentityFactory,
  SystemNovelClock,
  captureNovelArtifactId,
  captureNovelCommitId,
  captureNovelConflictId,
  captureNovelDraftSessionId,
  captureNovelEntityVersion,
  captureNovelId,
  captureNovelOperationId,
  captureNovelRevision,
  captureNovelSchemaVersion,
  captureNovelTimestamp,
} from "../dist/index.js";

const identities = new RandomNovelIdentityFactory();
const novelId = identities.createNovelId();
const draftSessionId = identities.createDraftSessionId();
const generated = [
  novelId,
  draftSessionId,
  identities.createOperationId(),
  identities.createCommitId(),
  identities.createConflictId(),
  identities.createArtifactId(),
];
assert.equal(new Set(generated).size, generated.length);
assert.match(novelId, /^novel_[a-f0-9]{32}$/u);
assert.match(draftSessionId, /^draft_[a-f0-9]{32}$/u);

assert.equal(captureNovelId("novel_example"), "novel_example");
assert.equal(captureNovelDraftSessionId("draft_example"), "draft_example");
assert.equal(captureNovelOperationId("operation_example"), "operation_example");
assert.equal(captureNovelCommitId("commit_example"), "commit_example");
assert.equal(captureNovelConflictId("conflict_example"), "conflict_example");
assert.equal(captureNovelArtifactId("artifact_example"), "artifact_example");
for (const invalidIdentity of ["", " contains-space", "../escape", "a/b", "a\\b"]) {
  assertProtocolFailure(
    () => captureNovelId(invalidIdentity),
    NOVEL_PROTOCOL_FAILURE.invalidIdentity,
  );
}
assertProtocolFailure(
  () => captureNovelId(`novel_${"a".repeat(160)}`),
  NOVEL_PROTOCOL_FAILURE.invalidIdentity,
);
assertProtocolFailure(
  () => captureNovelId("novel_control\u0000value"),
  NOVEL_PROTOCOL_FAILURE.invalidIdentity,
);

assert.equal(captureNovelRevision("revision_0"), "revision_0");
assert.equal(captureNovelSchemaVersion(1), 1);
assert.equal(captureNovelEntityVersion(1), 1);
assert.equal(
  captureNovelTimestamp("2026-08-02T00:00:00.000Z"),
  "2026-08-02T00:00:00.000Z",
);
assertProtocolFailure(
  () => captureNovelRevision("revision value"),
  NOVEL_PROTOCOL_FAILURE.invalidRevision,
);
for (const invalidVersion of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
  assertProtocolFailure(
    () => captureNovelSchemaVersion(invalidVersion),
    NOVEL_PROTOCOL_FAILURE.invalidSchemaVersion,
  );
  assertProtocolFailure(
    () => captureNovelEntityVersion(invalidVersion),
    NOVEL_PROTOCOL_FAILURE.invalidEntityVersion,
  );
}
assertProtocolFailure(
  () => captureNovelTimestamp("2026-08-02"),
  NOVEL_PROTOCOL_FAILURE.invalidTimestamp,
);

const timestamp = new SystemNovelClock().now();
assert.equal(new Date(timestamp).toISOString(), timestamp);

const missingError = new NovelDraftSessionNotFoundError(draftSessionId);
assert.equal(missingError.code, "NOVEL_DRAFT_SESSION_NOT_FOUND");
assert.equal(missingError.message, "Novel Draft Session was not found");
const stateError = new NovelDraftSessionStateError(
  draftSessionId,
  ["active"],
  "committed",
);
assert.equal(Object.isFrozen(stateError.expectedStates), true);
const redactedStateError = new NovelDraftSessionStateError(
  draftSessionId,
  ["active", "private state text"],
  "private current state text",
);
assert.deepEqual(redactedStateError.expectedStates, ["active", "unknown"]);
assert.equal(redactedStateError.actualState, "unknown");
const revisionError = new NovelRevisionConflictError(
  novelId,
  captureNovelRevision("revision_1"),
  captureNovelRevision("revision_2"),
  draftSessionId,
);
assert.equal(revisionError.message, "Novel revision conflict");
const invariantError = new NovelInvariantViolationError(
  NOVEL_INVARIANT_FAILURE.persistenceInvariant,
  novelId,
  draftSessionId,
);
assert.equal(invariantError.message, "Novel invariant violated");

const privateValue = "DO_NOT_EXPOSE_NOVEL_PRIVATE_VALUE";
for (const invoke of [
  () => captureNovelId(privateValue.toLowerCase().replaceAll("_", "/")),
  () => captureNovelRevision(`${privateValue} value`),
]) {
  try {
    invoke();
    assert.fail("Expected Novel protocol validation to fail");
  } catch (error) {
    assert.equal(error instanceof NovelProtocolValidationError, true);
    assert.equal(error.message.includes(privateValue), false);
    assert.equal(JSON.stringify(error).includes(privateValue), false);
  }
}
const redactedFieldError = new NovelProtocolValidationError(
  NOVEL_PROTOCOL_FAILURE.invalidIdentity,
  privateValue,
);
assert.equal(redactedFieldError.field, undefined);
assert.equal(JSON.stringify(redactedFieldError).includes(privateValue), false);

console.log("novel foundation smoke passed");

function assertProtocolFailure(invoke, failure) {
  assert.throws(invoke, (error) => {
    assert.equal(error instanceof NovelProtocolValidationError, true);
    assert.equal(error.failure, failure);
    return true;
  });
}
