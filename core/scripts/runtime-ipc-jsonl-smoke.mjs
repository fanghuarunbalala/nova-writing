import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import {
  RuntimeIpcPeer,
} from "../dist/index.js";
import {
  NODE_JSONL_IPC_FAILURE,
  NodeJsonlFrameDecoder,
  NodeJsonlIpcConnection,
  NodeJsonlIpcError,
} from "../dist/node/index.js";

class SlowCollectingWritable extends Writable {
  constructor() {
    super({ highWaterMark: 1 });
    this.output = "";
  }
  _write(chunk, _encoding, callback) {
    setTimeout(() => {
      this.output += chunk.toString("utf8");
      callback();
    }, 1);
  }
}

class ClosingWritable extends Writable {
  constructor() {
    super({ highWaterMark: 1 });
  }
  _write(_chunk, _encoding, _callback) {
    setImmediate(() => this.destroy());
  }
}

const privatePayload = "DO_NOT_LOG_JSONL_FRAME_CONTENT";
const frame = notification("notification-fragment", { text: `章节-${privatePayload}` });
const encoded = Buffer.from(`${JSON.stringify(frame)}\n`, "utf8");
const splitAt = encoded.indexOf(Buffer.from("章")) + 1;
const decoder = new NodeJsonlFrameDecoder();
assert.deepEqual(decoder.push(encoded.subarray(0, splitAt)), []);
assert.deepEqual(decoder.push(encoded.subarray(splitAt)), [frame]);
decoder.finish();

const multiDecoder = new NodeJsonlFrameDecoder();
assert.deepEqual(multiDecoder.push(
  `${JSON.stringify(notification("notification-1", null))}\r\n` +
  `${JSON.stringify(notification("notification-2", { value: 2 }))}\n`,
), [
  notification("notification-1", null),
  notification("notification-2", { value: 2 }),
]);
multiDecoder.finish();

assertDecoderFailure(() => {
  const invalid = new NodeJsonlFrameDecoder();
  invalid.push("not-json\n");
}, NODE_JSONL_IPC_FAILURE.invalidJson);
assertDecoderFailure(() => {
  const invalid = new NodeJsonlFrameDecoder({ maximumLineBytes: 32 });
  invalid.push("x".repeat(33));
}, NODE_JSONL_IPC_FAILURE.lineOversized);
assertDecoderFailure(() => {
  const invalid = new NodeJsonlFrameDecoder();
  invalid.push(JSON.stringify(frame));
  invalid.finish();
}, NODE_JSONL_IPC_FAILURE.incompleteLine);
assertDecoderFailure(() => {
  const invalid = new NodeJsonlFrameDecoder();
  invalid.push("{}\n");
}, NODE_JSONL_IPC_FAILURE.invalidFrame);

const parentToChild = new PassThrough();
const childToParent = new PassThrough();
const parentConnection = new NodeJsonlIpcConnection({
  readable: childToParent,
  writable: parentToChild,
});
const childConnection = new NodeJsonlIpcConnection({
  readable: parentToChild,
  writable: childToParent,
});
const childPeer = new RuntimeIpcPeer({
  sessionId: "session-jsonl",
  connection: childConnection,
  requestHandler: {
    async handle(method, payload) {
      return { method, echoed: payload.value };
    },
  },
});
const parentPeer = new RuntimeIpcPeer({
  sessionId: "session-jsonl",
  connection: parentConnection,
});
childPeer.start();
parentPeer.start();
assert.deepEqual(
  await parentPeer.request("runtime.echo", { value: "jsonl" }),
  { method: "runtime.echo", echoed: "jsonl" },
);
await Promise.all([parentPeer.close(), childPeer.close()]);

const collectingWritable = new SlowCollectingWritable();
const unusedReadable = new PassThrough();
const orderedConnection = new NodeJsonlIpcConnection({
  readable: unusedReadable,
  writable: collectingWritable,
});
await Promise.all([
  orderedConnection.send(notification("ordered-1", { value: 1 })),
  orderedConnection.send(notification("ordered-2", { value: 2 })),
  orderedConnection.send(notification("ordered-3", { value: 3 })),
]);
assert.deepEqual(
  collectingWritable.output.trim().split("\n").map((line) => JSON.parse(line).notificationId),
  ["ordered-1", "ordered-2", "ordered-3"],
);
await orderedConnection.close();

const oversizedReadable = new PassThrough();
const oversizedWritable = new PassThrough();
const oversizedConnection = new NodeJsonlIpcConnection({
  readable: oversizedReadable,
  writable: oversizedWritable,
  maximumLineBytes: 64,
});
oversizedReadable.write("x".repeat(65));
await assert.rejects(
  oversizedConnection.next(),
  (error) =>
    error instanceof NodeJsonlIpcError &&
    error.failure === NODE_JSONL_IPC_FAILURE.lineOversized,
);
await oversizedConnection.close();

const closingConnection = new NodeJsonlIpcConnection({
  readable: new PassThrough(),
  writable: new ClosingWritable(),
});
await assert.rejects(
  closingConnection.send(notification("closing-writable", null)),
  (error) =>
    error instanceof NodeJsonlIpcError &&
    error.failure === NODE_JSONL_IPC_FAILURE.streamFailed,
);
await closingConnection.close();

console.log("Runtime IPC Node JSONL smoke passed");

function notification(notificationId, payload) {
  return {
    frameType: "notification",
    protocolVersion: 1,
    sessionId: "session-jsonl",
    notificationId,
    method: "runtime.heartbeat",
    payload,
  };
}

function assertDecoderFailure(invoke, failure) {
  assert.throws(invoke, (error) => {
    assert.equal(error instanceof NodeJsonlIpcError, true);
    assert.equal(error.failure, failure);
    assert.equal(String(error).includes(privatePayload), false);
    return true;
  });
}
