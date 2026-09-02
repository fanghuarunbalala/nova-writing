import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMainProcessLogger } from "../dist/main/index.js";

const root = await mkdtemp(join(tmpdir(), "main-process-logger-"));
try {
  const records = (content) =>
    content
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));

  // pino-roll 按 `file.<number>.log` 命名活动文件，收集目录内全部 .log。
  // worker transport 异步落盘，轮询等待记录出现（最多 ~2s）。
  async function readAll(dir, attempts = 40) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const files = (await readdir(dir)).filter((file) => file.endsWith(".log"));
        if (files.length > 0) {
          const parts = [];
          for (const file of files) {
            parts.push(await readFile(join(dir, file), "utf8"));
          }
          const content = parts.join("");
          if (content.trim().length > 0) return content;
        }
      } catch {
        // 目录尚未创建，重试。
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`log dir never produced records: ${dir}`);
  }

  // 默认 info 级别：error/warn/info 落盘，debug 被 pino 门控丢弃；记录为 JSON 且带 event key。
  const infoDir = join(root, "info");
  const infoLogger = createMainProcessLogger(join(infoDir, "runtime-info.log"));
  infoLogger.error("main.process.error", { code: "ERR" });
  infoLogger.warn("main.process.warn", { code: "WARN" });
  infoLogger.info("main.process.info", { code: "INFO" });
  infoLogger.debug("main.process.debug", { code: "DEBUG" });
  await infoLogger.flush?.();
  const infoRecords = records(await readAll(infoDir));
  assert.deepEqual(
    infoRecords.map((record) => record.event),
    ["main.process.error", "main.process.warn", "main.process.info"],
  );
  assert.deepEqual(
    infoRecords.map((record) => record.level),
    [50, 40, 30],
  );
  assert.equal(infoRecords[0].code, "ERR");

  // verbose 级别：debug 落盘，verbose 映射为 pino trace（level 10）。
  const debugDir = join(root, "debug");
  const debugLogger = createMainProcessLogger(
    join(debugDir, "runtime-debug.log"),
    "verbose",
  );
  debugLogger.info("main.process.info", {});
  debugLogger.debug("main.process.debug", {});
  debugLogger.verbose?.("main.process.verbose", {});
  await debugLogger.flush?.();
  const debugRecords = records(await readAll(debugDir));
  assert.deepEqual(
    debugRecords.map((record) => record.event),
    ["main.process.info", "main.process.debug", "main.process.verbose"],
  );
  assert.deepEqual(
    debugRecords.map((record) => record.level),
    [30, 20, 10],
  );

  assert.ok(createMainProcessLogger("") !== undefined);
  console.log("Main process logger smoke passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
