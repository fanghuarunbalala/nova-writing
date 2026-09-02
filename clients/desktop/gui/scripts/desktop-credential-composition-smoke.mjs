import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ApplicationConfiguration,
  CredentialReference,
  createDefaultApplicationConfiguration,
} from "../../core/dist/index.js";
import {
  NodeApplicationConfigurationStore,
  NodeConfigurationHomeResolver,
  NodeCredentialMigrationStateStore,
  NodeEncryptedCredentialStore,
  NodeLegacyCredentialMigrator,
  NodePlaintextCredentialStore,
} from "../../core/dist/node/index.js";
import {
  DesktopConfigurationService,
  DesktopCredentialMigrationCoordinator,
  collectApplicationCredentialReferences,
} from "../dist/main/config/index.js";

class FakeCredentialCipher {
  async isAvailable() {
    return true;
  }

  async encrypt(secret) {
    return Buffer.from(`encrypted:${secret}`, "utf8").reverse();
  }

  async decrypt(encrypted) {
    const value = Buffer.from(encrypted).reverse().toString("utf8");
    if (!value.startsWith("encrypted:")) throw new Error("invalid");
    return { secret: value.slice("encrypted:".length), shouldReEncrypt: false };
  }
}

class CollectingLogger {
  constructor(entries = [], bindings = {}) {
    this.entries = entries;
    this.bindings = bindings;
  }

  debug(event, fields) {
    this.#capture("debug", event, fields);
  }

  info(event, fields) {
    this.#capture("info", event, fields);
  }

  warn(event, fields) {
    this.#capture("warn", event, fields);
  }

  error(event, fields) {
    this.#capture("error", event, fields);
  }

  child(bindings) {
    return new CollectingLogger(this.entries, { ...this.bindings, ...bindings });
  }

  #capture(level, event, fields) {
    this.entries.push({ level, event, fields, bindings: this.bindings });
  }
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "novel-desktop-credential-"));
try {
  const logger = new CollectingLogger();
  const homeResolver = new NodeConfigurationHomeResolver({ rootDir: temporaryRoot });
  const configurationStore = new NodeApplicationConfigurationStore({ homeResolver });
  const legacyStore = new NodeEncryptedCredentialStore({
    homeResolver,
    cipher: new FakeCredentialCipher(),
  });
  const plaintextStore = new NodePlaintextCredentialStore({ homeResolver });
  const primaryReference = new CredentialReference("credential:desktop-primary");
  const headerReference = new CredentialReference("credential:desktop-header");
  const proxyReference = new CredentialReference("credential:desktop-proxy");
  const defaults = createDefaultApplicationConfiguration().toSnapshot();
  const configuration = new ApplicationConfiguration({
    ...defaults,
    revision: 0,
    network: {
      ...defaults.network,
      proxyCredentialRef: proxyReference.id,
    },
    modelConnections: [
      {
        id: "connection.desktop-primary",
        displayName: "Desktop Primary",
        providerKind: "openai",
        enabled: true,
        credentialRef: primaryReference.id,
        credentialConfigured: true,
        publicHeaders: {},
        secretHeaderCredentialRefs: {
          Authorization: headerReference.id,
          Duplicate: primaryReference.id,
        },
      },
    ],
  });
  await configurationStore.save(configuration);
  await legacyStore.save(primaryReference, "legacy-primary-secret");
  await legacyStore.save(headerReference, "legacy-header-secret");
  await plaintextStore.save(proxyReference, "plaintext-proxy-secret");

  assert.deepEqual(
    collectApplicationCredentialReferences(configuration).map((entry) => entry.id),
    [proxyReference.id, primaryReference.id, headerReference.id],
  );
  const coordinator = new DesktopCredentialMigrationCoordinator({
    store: configurationStore,
    migrator: new NodeLegacyCredentialMigrator({
      legacyStore,
      plaintextStore,
      stateStore: new NodeCredentialMigrationStateStore({ homeResolver }),
    }),
    logger,
  });
  assert.deepEqual(await coordinator.migrateKnownCredentials(), {
    referenceCount: 3,
    notRequiredCount: 0,
    alreadyMigratedCount: 1,
    migratedCount: 2,
    resumedCount: 0,
  });
  assert.equal(await legacyStore.getStatus(primaryReference), "missing");
  assert.equal(await legacyStore.getStatus(headerReference), "missing");

  const service = new DesktopConfigurationService({
    store: configurationStore,
    credentials: plaintextStore,
  });
  const projected = await service.load();
  assert.equal(projected.modelConnections[0].credentialConfigured, true);
  await service.saveCredential(primaryReference.id, "desktop-restart-secret");
  assert.equal(
    await plaintextStore.use(primaryReference, async (secret) => secret),
    "desktop-restart-secret",
  );

  const restartedStore = new NodePlaintextCredentialStore({ homeResolver });
  const restartedService = new DesktopConfigurationService({
    store: new NodeApplicationConfigurationStore({ homeResolver }),
    credentials: restartedStore,
  });
  assert.equal(
    (await restartedService.load()).modelConnections[0]
      .credentialConfigured,
    true,
  );

  const child = spawn(
    process.execPath,
    [join("scripts", "fixtures", "desktop-credential-child-use.mjs")],
    {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, NOVEL_HOME: temporaryRoot },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.resume();
  const exitCode = await new Promise((resolve) => child.once("exit", resolve));
  assert.equal(exitCode, 0, "Desktop Credential child failed");
  assert.equal(stdout.trim(), "DESKTOP_CREDENTIAL_CHILD_USE_OK");
  assert.equal(stdout.includes("desktop-restart-secret"), false);

  const serializedLogs = JSON.stringify(logger.entries);
  for (const forbidden of [
    temporaryRoot,
    primaryReference.id,
    headerReference.id,
    proxyReference.id,
    "legacy-primary-secret",
    "legacy-header-secret",
    "plaintext-proxy-secret",
    "desktop-restart-secret",
  ]) {
    assert.equal(serializedLogs.includes(forbidden), false, forbidden);
  }

  const mainSource = await readFile(
    new URL("../src/main/main.ts", import.meta.url),
    "utf8",
  );
  assert.match(mainSource, /credentials: plaintextCredentialStore/u);
  assert.match(mainSource, /await credentialMigration\.migrateKnownCredentials\(\)/u);
  assert.match(mainSource, /legacyStore: legacyCredentialStore/u);

  console.log("Desktop Credential Composition smoke passed");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
