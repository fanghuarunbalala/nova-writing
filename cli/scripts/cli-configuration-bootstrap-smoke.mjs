import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NodeApplicationConfigurationStore,
  NodeConfigurationHomeResolver,
} from "@novel/core/node";
import { CliConfigurationBootstrap } from "../dist/config/index.js";

const temporaryRoot = await mkdtemp(join(tmpdir(), "novel-cli-config-"));
const previousDebug = process.env.NOVEL_DEBUG;
const previousDump = process.env.NOVEL_PROVIDER_REQUEST_DUMP;
try {
  const homeResolver = new NodeConfigurationHomeResolver({
    environment: { NOVEL_HOME: temporaryRoot },
    homeDir: join(temporaryRoot, "ignored"),
  });
  const store = new NodeApplicationConfigurationStore({ homeResolver });
  const bootstrap = new CliConfigurationBootstrap({ store });
  const initialized = await bootstrap.load();
  assert.equal(initialized.revision, 0);
  assert.equal(initialized.general.locale, "zh-CN");
  const restored = await new CliConfigurationBootstrap({
    store: new NodeApplicationConfigurationStore({ homeResolver }),
  }).load();
  assert.equal(restored.revision, 0);
  assert.deepEqual(restored.toSnapshot(), initialized.toSnapshot());
  process.env.NOVEL_DEBUG = "verbose";
  process.env.NOVEL_PROVIDER_REQUEST_DUMP = join(temporaryRoot, "dump.jsonl");
  const debugConfig = await new CliConfigurationBootstrap({
    store: new NodeApplicationConfigurationStore({ homeResolver }),
  }).load();
  assert.equal(debugConfig.diagnostics.logLevel, "verbose");
  assert.equal(debugConfig.diagnostics.providerRequestDumpEnabled, true);
  assert.equal(
    debugConfig.diagnostics.providerRequestDumpPath,
    join(temporaryRoot, "dump.jsonl"),
  );
  console.log("CLI Configuration Bootstrap smoke passed");
} finally {
  if (previousDebug === undefined) {
    delete process.env.NOVEL_DEBUG;
  } else {
    process.env.NOVEL_DEBUG = previousDebug;
  }
  if (previousDump === undefined) {
    delete process.env.NOVEL_PROVIDER_REQUEST_DUMP;
  } else {
    process.env.NOVEL_PROVIDER_REQUEST_DUMP = previousDump;
  }
  await rm(temporaryRoot, { recursive: true, force: true });
}
