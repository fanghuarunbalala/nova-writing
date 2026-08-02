import assert from "node:assert/strict";
import {
  NOVEL_PROTOCOL_FAILURE,
  FractionalOrderKeyFactory,
  NovelProtocolValidationError,
  captureOrderKey,
  compareOrderKeys,
} from "../dist/index.js";

const factory = new FractionalOrderKeyFactory();

assert.equal(captureOrderKey("8000"), "8000");
assert.equal(captureOrderKey("00008000"), "00008000");
assert.equal(captureOrderKey("FFFF8000"), "FFFF8000");
for (const invalid of [
  undefined,
  "",
  "800",
  "80000",
  "8000 ",
  "8000abcd",
  "GGGG",
  "0000",
  "80000000",
]) {
  assertProtocolFailure(() => captureOrderKey(invalid));
}

assert.equal(
  compareOrderKeys(captureOrderKey("4000"), captureOrderKey("8000")),
  -1,
);
assert.equal(
  compareOrderKeys(captureOrderKey("8000"), captureOrderKey("8000")),
  0,
);
assert.equal(
  compareOrderKeys(captureOrderKey("C000"), captureOrderKey("8000")),
  1,
);
assert.equal(
  compareOrderKeys(captureOrderKey("4000"), captureOrderKey("40008000")),
  -1,
);

const initial = factory.initial();
assert.equal(initial, "8000");
assert.equal(factory.before(initial), "4000");
assert.equal(factory.after(initial), "C000");
assert.equal(
  factory.between(captureOrderKey("4000"), captureOrderKey("8000")),
  "6000",
);
assert.equal(
  factory.between(captureOrderKey("4000"), captureOrderKey("4001")),
  "40008000",
);
assert.equal(
  factory.between(captureOrderKey("4000"), captureOrderKey("40000001")),
  "400000008000",
);
assert.equal(factory.before(captureOrderKey("00000001")), "000000008000");
assert.equal(factory.after(captureOrderKey("FFFF")), "FFFF8000");

for (const [previous, next] of [
  ["8000", "4000"],
  ["8000", "8000"],
]) {
  assertProtocolFailure(() =>
    factory.between(captureOrderKey(previous), captureOrderKey(next)),
  );
}

let lower = factory.before(initial);
let upper = initial;
const denseKeys = [];
for (let index = 0; index < 512; index += 1) {
  const generated = factory.between(lower, upper);
  assert.equal(compareOrderKeys(lower, generated), -1);
  assert.equal(compareOrderKeys(generated, upper), -1);
  assert.equal(generated.endsWith("0000"), false);
  denseKeys.push(generated);
  upper = generated;
}
assert.equal(new Set(denseKeys).size, denseKeys.length);

const ordered = [factory.before(initial), initial, factory.after(initial)];
for (let index = 0; index < 128; index += 1) {
  const insertionIndex = index % (ordered.length - 1);
  ordered.splice(
    insertionIndex + 1,
    0,
    factory.between(ordered[insertionIndex], ordered[insertionIndex + 1]),
  );
}
assert.deepEqual([...ordered].sort(compareOrderKeys), ordered);
assert.equal(new Set(ordered).size, ordered.length);

console.log("novel order key smoke passed");

function assertProtocolFailure(invoke) {
  assert.throws(invoke, (error) => {
    assert.equal(error instanceof NovelProtocolValidationError, true);
    assert.equal(error.failure, NOVEL_PROTOCOL_FAILURE.invalidOrderKey);
    assert.equal(error.field, "orderKey");
    assert.equal(error.message, "Novel protocol validation failed");
    return true;
  });
}
