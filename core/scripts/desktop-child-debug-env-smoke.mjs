import assert from "node:assert/strict";
import {
  DESKTOP_CHILD_DEBUG_ENV,
  DESKTOP_PROVIDER_REQUEST_DUMP_ENV,
  resolveChildDebugDiagnostics,
} from "../dist/node/index.js";

assert.equal(resolveChildDebugDiagnostics({}, {}).logLevel, "info");
assert.equal(
  resolveChildDebugDiagnostics({ logLevel: "debug" }, {}).logLevel,
  "debug",
);
assert.equal(
  resolveChildDebugDiagnostics({}, { [DESKTOP_CHILD_DEBUG_ENV]: "1" }).logLevel,
  "debug",
);
assert.equal(
  resolveChildDebugDiagnostics({}, { [DESKTOP_CHILD_DEBUG_ENV]: "debug" })
    .logLevel,
  "debug",
);
assert.equal(
  resolveChildDebugDiagnostics({}, { [DESKTOP_CHILD_DEBUG_ENV]: "verbose" })
    .logLevel,
  "verbose",
);
assert.equal(
  resolveChildDebugDiagnostics(
    { logLevel: "info" },
    { [DESKTOP_CHILD_DEBUG_ENV]: "verbose" },
  ).logLevel,
  "verbose",
);
const envDump = resolveChildDebugDiagnostics(
  {},
  { [DESKTOP_PROVIDER_REQUEST_DUMP_ENV]: "/tmp/dump.jsonl" },
);
assert.equal(envDump.dumpPath, "/tmp/dump.jsonl");
const configDump = resolveChildDebugDiagnostics(
  {
    providerRequestDumpEnabled: true,
    providerRequestDumpPath: "/cfg/dump.jsonl",
  },
  {},
);
assert.equal(configDump.dumpPath, "/cfg/dump.jsonl");
const disabled = resolveChildDebugDiagnostics(
  {
    providerRequestDumpEnabled: false,
    providerRequestDumpPath: "/cfg/dump.jsonl",
  },
  {},
);
assert.equal(disabled.dumpPath, undefined);

console.log("CORE_SMOKE_TEST_RESULT=pass desktop-child-debug-env");
