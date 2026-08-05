import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMainProcessLogger } from "../dist/main/index.js";

const root = await mkdtemp(join(tmpdir(), "main-process-logger-"));
try {
  const logPath = join(root, "runtime-main.log");
  const logger = createMainProcessLogger(logPath);
  logger.error("main.process.error", { code: "ERR" });
  logger.warn("main.process.warn", { code: "WARN" });
  logger.info("main.process.info", { code: "INFO" });
  logger.debug("main.process.debug", { code: "DEBUG" });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const content = await readFile(logPath, "utf8");
  assert.match(content, /ERROR main\.process\.error/);
  assert.match(content, /WARN main\.process\.warn/);
  assert.match(content, /INFO main\.process\.info/);
  assert.match(content, /DEBUG main\.process\.debug/);
  assert.ok(createMainProcessLogger("") !== undefined);
  console.log("Main process logger smoke passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
