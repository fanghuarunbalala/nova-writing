import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  RUNTIME_IPC_FRAME_TYPE,
  RUNTIME_IPC_MAX_FRAME_BYTES,
  RUNTIME_IPC_PROTOCOL_FAILURE,
  RUNTIME_IPC_PROTOCOL_FAMILY,
  RUNTIME_IPC_PROTOCOL_VERSION,
  RUNTIME_IPC_SUPPORTED_PROTOCOL_RANGE,
  RuntimeIpcProtocolError,
  RuntimeIpcRemoteError,
  captureRuntimeIpcErrorSnapshot,
  captureRuntimeIpcFrame,
  captureRuntimeIpcProtocolRange,
  negotiateRuntimeIpcProtocolVersion,
  sameRuntimeIpcRequest,
} from "../dist/index.js";

const privatePayload = "DO_NOT_EXPOSE_RUNTIME_IPC_PAYLOAD";
const hello = captureRuntimeIpcFrame({
  frameType: RUNTIME_IPC_FRAME_TYPE.hello,
  protocolFamily: RUNTIME_IPC_PROTOCOL_FAMILY,
  supportedProtocol: { minimumVersion: 1, maximumVersion: 1 },
  processNonce: "process-nonce-1",
});
assert.deepEqual(hello, {
  frameType: "hello",
  protocolFamily: "novel.runtime.ipc",
  supportedProtocol: { minimumVersion: 1, maximumVersion: 1 },
  processNonce: "process-nonce-1",
});
assert.equal(Object.isFrozen(hello), true);
assert.equal(Object.isFrozen(hello.supportedProtocol), true);

assert.deepEqual(captureRuntimeIpcFrame({
  frameType: "welcome",
  protocolVersion: RUNTIME_IPC_PROTOCOL_VERSION,
  sessionId: "session-1",
  processNonce: "process-nonce-1",
}), {
  frameType: "welcome",
  protocolVersion: 1,
  sessionId: "session-1",
  processNonce: "process-nonce-1",
});
assert.deepEqual(captureRuntimeIpcFrame({
  frameType: "rejected",
  protocolFamily: RUNTIME_IPC_PROTOCOL_FAMILY,
  reason: "unsupported_version",
  supportedProtocol: RUNTIME_IPC_SUPPORTED_PROTOCOL_RANGE,
  processNonce: "process-nonce-2",
}), {
  frameType: "rejected",
  protocolFamily: "novel.runtime.ipc",
  reason: "unsupported_version",
  supportedProtocol: { minimumVersion: 1, maximumVersion: 1 },
  processNonce: "process-nonce-2",
});

const sourcePayload = {
  text: privatePayload,
  nested: { count: 1 },
  ordered: ["first", "second"],
};
const request = captureRuntimeIpcFrame(requestFrame(sourcePayload));
assert.equal(request.frameType, "request");
sourcePayload.nested.count = 99;
sourcePayload.ordered.push("third");
assert.deepEqual(request.payload, {
  text: privatePayload,
  nested: { count: 1 },
  ordered: ["first", "second"],
});
assert.equal(Object.isFrozen(request), true);
assert.equal(Object.isFrozen(request.payload), true);
assert.equal(Object.isFrozen(request.payload.nested), true);
assert.equal(Object.isFrozen(request.payload.ordered), true);

const reorderedRequest = requestFrame({
  ordered: ["first", "second"],
  nested: { count: 1 },
  text: privatePayload,
});
assert.equal(sameRuntimeIpcRequest(request, reorderedRequest), true);
assert.equal(sameRuntimeIpcRequest(request, requestFrame({ text: "changed" })), false);

assert.deepEqual(captureRuntimeIpcFrame({
  frameType: "response",
  protocolVersion: 1,
  sessionId: "session-1",
  requestId: "request-1",
  ok: true,
  data: { accepted: true },
}), {
  frameType: "response",
  protocolVersion: 1,
  sessionId: "session-1",
  requestId: "request-1",
  ok: true,
  data: { accepted: true },
});
const failureResponse = captureRuntimeIpcFrame({
  frameType: "response",
  protocolVersion: 1,
  sessionId: "session-1",
  requestId: "request-2",
  ok: false,
  error: {
    code: "RUNTIME_NOT_READY",
    category: "unavailable",
    retryable: true,
  },
});
assert.equal(Object.isFrozen(failureResponse.error), true);
const remoteError = new RuntimeIpcRemoteError(failureResponse.error);
assert.equal(remoteError.code, "RUNTIME_NOT_READY");
assert.equal(remoteError.category, "unavailable");
assert.equal(remoteError.retryable, true);

assert.deepEqual(captureRuntimeIpcFrame({
  frameType: "notification",
  protocolVersion: 1,
  sessionId: "session-1",
  notificationId: "heartbeat-1",
  method: "runtime.heartbeat",
  payload: { sequence: 1 },
}), {
  frameType: "notification",
  protocolVersion: 1,
  sessionId: "session-1",
  notificationId: "heartbeat-1",
  method: "runtime.heartbeat",
  payload: { sequence: 1 },
});

assert.equal(
  negotiateRuntimeIpcProtocolVersion(
    { minimumVersion: 1, maximumVersion: 3 },
    { minimumVersion: 2, maximumVersion: 4 },
  ),
  3,
);
assert.deepEqual(captureRuntimeIpcProtocolRange({
  minimumVersion: 1,
  maximumVersion: 65_535,
}), {
  minimumVersion: 1,
  maximumVersion: 65_535,
});
assertProtocolFailure(
  () => negotiateRuntimeIpcProtocolVersion(
    { minimumVersion: 1, maximumVersion: 1 },
    { minimumVersion: 2, maximumVersion: 2 },
  ),
  RUNTIME_IPC_PROTOCOL_FAILURE.unsupportedProtocolVersion,
);
assertProtocolFailure(
  () => captureRuntimeIpcProtocolRange({ minimumVersion: 2, maximumVersion: 1 }),
  RUNTIME_IPC_PROTOCOL_FAILURE.invalidProtocolRange,
);

for (const invalidFrame of [
  { ...requestFrame({}), extra: privatePayload },
  { ...requestFrame({}), protocolVersion: 99 },
  { ...requestFrame({}), sessionId: "" },
  { ...requestFrame({}), requestId: "invalid request" },
  { ...requestFrame({}), method: "runtime" },
  { ...requestFrame({}), payload: undefined },
  { ...requestFrame({}), payload: Number.NaN },
  { ...requestFrame({}), payload: () => privatePayload },
  {
    frameType: "response",
    protocolVersion: 1,
    sessionId: "session-1",
    requestId: "request-1",
    ok: true,
    data: {},
    error: { code: "INVALID", category: "internal", retryable: false },
  },
]) {
  assertProtocolFailure(
    () => captureRuntimeIpcFrame(invalidFrame),
    RUNTIME_IPC_PROTOCOL_FAILURE.invalidFrame,
  );
}

const cyclicPayload = {};
cyclicPayload.self = cyclicPayload;
assertProtocolFailure(
  () => captureRuntimeIpcFrame(requestFrame(cyclicPayload)),
  RUNTIME_IPC_PROTOCOL_FAILURE.invalidFrame,
);
const accessorFrame = requestFrame({});
Object.defineProperty(accessorFrame, "payload", {
  enumerable: true,
  get() { throw new Error(privatePayload); },
});
assertProtocolFailure(
  () => captureRuntimeIpcFrame(accessorFrame),
  RUNTIME_IPC_PROTOCOL_FAILURE.invalidFrame,
);
assertProtocolFailure(
  () => captureRuntimeIpcFrame(requestFrame({
    text: "x".repeat(RUNTIME_IPC_MAX_FRAME_BYTES),
  })),
  RUNTIME_IPC_PROTOCOL_FAILURE.frameOversized,
);

assert.deepEqual(captureRuntimeIpcErrorSnapshot({
  code: "IPC_BACKPRESSURE",
  category: "unavailable",
  retryable: true,
}), {
  code: "IPC_BACKPRESSURE",
  category: "unavailable",
  retryable: true,
});
assertProtocolFailure(
  () => captureRuntimeIpcErrorSnapshot({
    code: `unsafe-${privatePayload}`,
    category: "internal",
    retryable: false,
  }),
  RUNTIME_IPC_PROTOCOL_FAILURE.invalidErrorSnapshot,
);
assert.throws(
  () => new RuntimeIpcRemoteError({
    code: `unsafe-${privatePayload}`,
    category: "internal",
    retryable: false,
  }),
  TypeError,
);

try {
  captureRuntimeIpcFrame({
    ...requestFrame({}),
    method: privatePayload,
  });
  assert.fail("expected invalid Runtime IPC frame");
} catch (error) {
  assert.equal(error instanceof RuntimeIpcProtocolError, true);
  assert.equal(String(error).includes(privatePayload), false);
  assert.equal(JSON.stringify(error).includes(privatePayload), false);
  assert.equal(Object.isFrozen(error.identity), true);
}

for (const declarationPath of [
  "index.d.ts",
  "runtime/index.d.ts",
  "runtime/ipc/index.d.ts",
  "runtime/ipc/protocol/index.d.ts",
]) {
  const declaration = await readFile(join(process.cwd(), "dist", declarationPath), "utf8");
  for (const forbidden of ["node:", "child_process", "@earendil-works/pi-agent-core"]) {
    assert.equal(declaration.includes(forbidden), false, `${forbidden} leaked through ${declarationPath}`);
  }
}

console.log("Runtime IPC protocol smoke passed");

function requestFrame(payload) {
  return {
    frameType: "request",
    protocolVersion: 1,
    sessionId: "session-1",
    requestId: "request-1",
    method: "runtime.start",
    payload,
  };
}

function assertProtocolFailure(invoke, expectedFailure) {
  assert.throws(invoke, (error) => {
    assert.equal(error instanceof RuntimeIpcProtocolError, true);
    assert.equal(error.failure, expectedFailure);
    assert.equal(String(error).includes(privatePayload), false);
    assert.equal(JSON.stringify(error).includes(privatePayload), false);
    return true;
  });
}
