import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRotatingFileLogger } from "../dist/node/index.js";

const root = await mkdtemp(join(tmpdir(), "rotating-pino-logger-"));
try {
  const records = (content) =>
    content
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));

  // pino-roll 按 `file.<number>.log` 命名活动文件，收集 logs/ 目录全部 .log。
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

  // per-workspace 路径（storeDir/logs/，目录尚不存在）：pino-roll 自动 mkdir。
  const storeDir = join(root, "documents-xiao-shuo-test--07d3ac3d");
  const logPath = join(storeDir, "logs", "runtime-main.log");
  const logger = createRotatingFileLogger({ file: logPath });

  // child 绑定 workspaceId + workspaceName（可读 name-id）会出现在每条记录里。
  const scoped = logger.child({
    workspaceId: "ws-1a2b3c4d",
    workspaceName: "documents-xiao-shuo-test--07d3ac3d",
  });
  scoped.info("desktop_workspace_application.open_started");
  scoped.debug("runtime.persistence.request_started", {}); // info 级别下被门控丢弃
  await scoped.flush?.();

  const infoRecords = records(await readAll(join(storeDir, "logs")));
  assert.equal(infoRecords.length, 1);
  assert.equal(infoRecords[0].event, "desktop_workspace_application.open_started");
  assert.equal(infoRecords[0].workspaceId, "ws-1a2b3c4d");
  assert.equal(infoRecords[0].workspaceName, "documents-xiao-shuo-test--07d3ac3d");
  assert.equal(infoRecords[0].level, 30);

  // verbose 级别：verbose 记录映射为 pino trace（level 10）。
  const verboseDir = join(root, "verbose");
  const verboseLogger = createRotatingFileLogger({
    file: join(verboseDir, "verbose.log"),
    level: "verbose",
  });
  verboseLogger.verbose?.("pi_provider_execution.request", { api: "pi" });
  await verboseLogger.flush?.();
  const verboseRecords = records(await readAll(verboseDir));
  assert.equal(verboseRecords[0].event, "pi_provider_execution.request");
  assert.equal(verboseRecords[0].level, 10);

  console.log("CORE_SMOKE_TEST_RESULT=pass rotating-pino-logger");
} finally {
  await rm(root, { recursive: true, force: true });
}
