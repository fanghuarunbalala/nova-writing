import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ApplicationConfiguration,
  WORKSPACE_CONFIGURATION_SCHEMA_VERSION,
  WorkspaceConfiguration,
  createDefaultApplicationConfiguration,
} from "../dist/index.js";
import {
  NODE_CONFIGURATION_STORE_FAILURE,
  NodeApplicationConfigurationStore,
  NodeConfigurationHomeResolver,
  NodeConfigurationStoreError,
  NodeWorkspaceConfigurationStore,
  NodeWorkspaceStoreLocator,
} from "../dist/node/index.js";

const temporaryRoot = await mkdtemp(join(tmpdir(), "novel-config-store-"));
try {
  const novelHome = join(temporaryRoot, "novel-home");
  const homeResolver = new NodeConfigurationHomeResolver({ rootDir: novelHome });
  const home = await homeResolver.resolve();
  assert.equal(home.rootDir, novelHome);
  assert.equal((await stat(home.configDir)).isDirectory(), true);
  assert.equal((await stat(home.credentialsDir)).isDirectory(), true);

  const environmentHome = join(temporaryRoot, "environment-home");
  const resolvedFromEnvironment = await new NodeConfigurationHomeResolver({
    environment: { NOVEL_HOME: environmentHome },
    homeDir: join(temporaryRoot, "ignored-home"),
  }).resolve();
  assert.equal(resolvedFromEnvironment.rootDir, environmentHome);

  const firstStore = new NodeApplicationConfigurationStore({ homeResolver });
  const secondStore = new NodeApplicationConfigurationStore({ homeResolver });
  assert.equal(await firstStore.load(), undefined);

  const revisionZero = createDefaultApplicationConfiguration();
  await firstStore.save(revisionZero);
  assert.equal((await secondStore.load())?.revision, 0);

  const revisionOneA = reviseApplication(revisionZero, {
    locale: "en-US",
  });
  const revisionOneB = reviseApplication(revisionZero, {
    locale: "ja-JP",
  });
  const concurrentWrites = await Promise.allSettled([
    firstStore.save(revisionOneA, 0),
    secondStore.save(revisionOneB, 0),
  ]);
  assert.equal(
    concurrentWrites.filter((result) => result.status === "fulfilled").length,
    1,
  );
  const rejected = concurrentWrites.find((result) => result.status === "rejected");
  assert.equal(rejected?.status, "rejected");
  assert.equal(rejected?.reason instanceof NodeConfigurationStoreError, true);
  assert.equal(
    rejected?.reason.failure,
    NODE_CONFIGURATION_STORE_FAILURE.revisionConflict,
  );
  const restoredApplication = await new NodeApplicationConfigurationStore({
    homeResolver,
  }).load();
  assert.equal(restoredApplication?.revision, 1);
  assert.equal(["en-US", "ja-JP"].includes(restoredApplication?.general.locale), true);
  const applicationFile = join(home.configDir, "application.json");
  if (process.platform !== "win32") {
    assert.equal((await stat(applicationFile)).mode & 0o777, 0o600);
  }
  const applicationJson = await readFile(applicationFile, "utf8");
  assert.equal(applicationJson.includes("apiKey"), false);
  assert.equal(applicationJson.includes("secret"), false);

  const workspaceRoot = join(temporaryRoot, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  const locator = new NodeWorkspaceStoreLocator({
    storageRoot: join(temporaryRoot, "workspace-storage"),
  });
  const location = await locator.resolve(workspaceRoot);
  const workspaceStore = new NodeWorkspaceConfigurationStore({ locator });
  assert.equal(await workspaceStore.load("workspace:missing"), undefined);
  assert.equal(await workspaceStore.load("workspace:missing"), undefined);
  await assert.rejects(
    workspaceStore.save(createWorkspace("workspace:missing", 0)),
    (error) => {
      assert.equal(error instanceof NodeConfigurationStoreError, true);
      assert.equal(error.failure, NODE_CONFIGURATION_STORE_FAILURE.workspaceMissing);
      return true;
    },
  );

  const workspaceRevisionZero = createWorkspace(location.workspaceId, 0);
  await workspaceStore.save(workspaceRevisionZero);
  const restoredWorkspace = await new NodeWorkspaceConfigurationStore({ locator }).load(
    location.workspaceId,
  );
  assert.equal(restoredWorkspace?.workspaceId, location.workspaceId);
  assert.equal(restoredWorkspace?.revision, 0);
  assert.equal(restoredWorkspace?.prepareRuntimeHostOnOpen, true);
  if (process.platform !== "win32") {
    assert.equal(
      (await stat(join(location.storeDir, "config", "workspace.json"))).mode & 0o777,
      0o600,
    );
  }
  console.log("Node Configuration Store smoke passed");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function reviseApplication(configuration, generalPatch) {
  const snapshot = configuration.toSnapshot();
  return new ApplicationConfiguration({
    ...snapshot,
    revision: snapshot.revision + 1,
    general: { ...snapshot.general, ...generalPatch },
  });
}

function createWorkspace(workspaceId, revision) {
  return new WorkspaceConfiguration({
    schemaVersion: WORKSPACE_CONFIGURATION_SCHEMA_VERSION,
    revision,
    workspaceId,
    defaultAgentType: "novel_agent",
    defaultRuntimeProfileId: "default",
    defaultToolPermissionProfileId: "default",
    subagentsEnabled: true,
    autosaveEnabled: true,
    automaticBackupEnabled: true,
    restoreConversationsOnOpen: true,
    prepareRuntimeHostOnOpen: true,
    allowToolsOutsideWorkspace: false,
    recoverDraftsAutomatically: true,
    draftRetentionDays: 30,
    artifactLimitBytes: 10_737_418_240,
    cacheLimitBytes: 2_147_483_648,
  });
}
