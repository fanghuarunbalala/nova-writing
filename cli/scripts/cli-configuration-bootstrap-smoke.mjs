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
  console.log("CLI Configuration Bootstrap smoke passed");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
