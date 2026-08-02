import assert from "node:assert/strict";
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelOperationHandlerNotFoundError,
  NovelOperationRegistrationError,
  NovelOperationRegistry,
  NovelOperationSynchronousHandlerError,
  NovelOperationExecutor,
  NovelProtocolValidationError,
  captureNovelEntityVersion,
  captureNovelOperation,
  captureNovelOperationId,
  captureNovelOperationVersion,
} from "../dist/index.js";

function operation(overrides = {}) {
  return {
    operationId: captureNovelOperationId("operation_smoke"),
    operationVersion: captureNovelOperationVersion(1),
    type: "character.rename",
    expected: [
      {
        kind: "entity-version",
        entityType: "character",
        entityId: "character_main",
        expectedEntityVersion: captureNovelEntityVersion(2),
      },
      {
        kind: "field-digest",
        entityType: "character",
        entityId: "character_main",
        fieldPath: "profile.name",
        expectedDigest: "opaque_digest_v1",
      },
    ],
    payload: { z: 1, nested: { b: true, a: ["x"] }, a: "name" },
    ...overrides,
  };
}

const captured = captureNovelOperation(operation());
assert.equal(Object.isFrozen(captured), true);
assert.equal(Object.isFrozen(captured.expected), true);
assert.equal(Object.isFrozen(captured.expected[0]), true);
assert.equal(Object.isFrozen(captured.payload), true);
assert.equal(Object.isFrozen(captured.payload.nested), true);
assert.equal(Object.isFrozen(captured.payload.nested.a), true);
assert.deepEqual(Object.keys(captured.payload), ["a", "nested", "z"]);

for (const invalid of [
  operation({ type: "rename" }),
  operation({ expected: [{ kind: "unknown", entityType: "character", entityId: "id" }] }),
  operation({ payload: { value: undefined } }),
  operation({ payload: { value: Number.POSITIVE_INFINITY } }),
]) {
  assert.throws(
    () => captureNovelOperation(invalid),
    (error) =>
      error instanceof NovelProtocolValidationError &&
      error.failure === NOVEL_PROTOCOL_FAILURE.invalidOperation,
  );
}

const applied = [];
const registry = new NovelOperationRegistry();
registry.register({
  operationType: "character.rename",
  operationVersion: captureNovelOperationVersion(1),
  apply(context, value) {
    context.push({ type: value.type, name: value.payload.a });
  },
});
await new NovelOperationExecutor(registry).execute(applied, captured);
assert.deepEqual(applied, [{ type: "character.rename", name: "name" }]);

assert.throws(
  () =>
    registry.register({
      operationType: "character.rename",
      operationVersion: captureNovelOperationVersion(1),
      apply() {},
    }),
  NovelOperationRegistrationError,
);
await assert.rejects(
  () =>
    new NovelOperationExecutor(registry).execute(
      applied,
      captureNovelOperation(operation({ type: "character.delete" })),
    ),
  NovelOperationHandlerNotFoundError,
);
assert.throws(
  () =>
    new NovelOperationRegistry().register({
      operationType: "character.async",
      operationVersion: captureNovelOperationVersion(1),
      async apply() {},
    }),
  NovelOperationSynchronousHandlerError,
);

const thenableRegistry = new NovelOperationRegistry();
thenableRegistry.register({
  operationType: "character.thenable",
  operationVersion: captureNovelOperationVersion(1),
  apply() { return Promise.resolve(); },
});
await assert.rejects(
  () =>
    new NovelOperationExecutor(thenableRegistry).execute(
      {},
      captureNovelOperation(operation({ type: "character.thenable" })),
    ),
  NovelOperationSynchronousHandlerError,
);

console.log("novel operation smoke passed");
