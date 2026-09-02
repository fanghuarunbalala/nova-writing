import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
  new URL("./configure-build-mode.mjs", import.meta.url),
);
const buildModeFile = join(dirname(script), "..", "dist", "build-mode.json");

execFileSync(process.execPath, [script, "debug"], { stdio: "pipe" });
assert.deepEqual(JSON.parse(await readFile(buildModeFile, "utf8")), {
  mode: "debug",
});
execFileSync(process.execPath, [script, "release"], { stdio: "pipe" });
assert.deepEqual(JSON.parse(await readFile(buildModeFile, "utf8")), {
  mode: "release",
});

console.log("GUI build mode smoke passed");
