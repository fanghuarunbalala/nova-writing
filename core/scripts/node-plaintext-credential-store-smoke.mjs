import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ApplicationConfiguration,
  CredentialReference,
  createDefaultApplicationConfiguration,
} from "../dist/index.js";
import {
  NODE_CONFIGURATION_STORE_FAILURE,
  NodeConfigurationHomeResolver,
  NodeConfigurationStoreError,
  NodePlaintextCredentialStore,
} from "../dist/node/index.js";

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

const temporaryRoot = await mkdtemp(join(tmpdir(), "novel-plaintext-credential-"));
try {
  const logger = new CollectingLogger();
  const homeResolver = new NodeConfigurationHomeResolver({ rootDir: temporaryRoot });
  const store = new NodePlaintextCredentialStore({ homeResolver, logger });
  const reference = new CredentialReference("credential:plaintext-primary");
  const credentialsDir = join(temporaryRoot, "credentials");
  const digest = createHash("sha256").update(reference.id, "utf8").digest("hex");
  const credentialPath = join(credentialsDir, `${digest}.plaintext-credential`);
  const lockPath = `${credentialPath}.lock`;
  const firstSecret = "test-provider-secret-v1";
  const secondSecret = "test-provider-secret-v2";

  assert.equal(await store.getStatus(reference), "missing");
  await store.save(reference, firstSecret);
  assert.equal(await store.getStatus(reference), "configured");

  const credentialFiles = (await readdir(credentialsDir)).filter((name) =>
    name.endsWith(".plaintext-credential"),
  );
  assert.deepEqual(credentialFiles, [`${digest}.plaintext-credential`]);
  assert.equal(credentialFiles[0].includes(reference.id), false);
  assert.deepEqual(JSON.parse(await readFile(credentialPath, "utf8")), {
    schemaVersion: 1,
    value: firstSecret,
  });
  if (process.platform !== "win32") {
    assert.equal((await stat(credentialsDir)).mode & 0o777, 0o700);
    assert.equal((await stat(credentialPath)).mode & 0o777, 0o600);
  }
  assert.equal(
    await store.use(reference, async (secret) => secret.length),
    firstSecret.length,
  );

  const defaults = createDefaultApplicationConfiguration().toSnapshot();
  const configuration = new ApplicationConfiguration({
    ...defaults,
    revision: 1,
    modelConnections: [
      {
        id: "connection.plaintext",
        displayName: "Plaintext Credential Connection",
        providerKind: "openai",
        enabled: true,
        credentialRef: reference.id,
        credentialConfigured: true,
        publicHeaders: {},
        secretHeaderCredentialRefs: {},
      },
    ],
  });
  const configurationSnapshot = JSON.stringify(configuration.toSnapshot());
  assert.equal(configurationSnapshot.includes(reference.id), true);
  assert.equal(configurationSnapshot.includes(firstSecret), false);

  await store.save(reference, secondSecret);
  assert.equal(
    await store.use(reference, async (secret) => secret),
    secondSecret,
  );
  assert.equal(
    (await readdir(credentialsDir)).some((name) => name.endsWith(".tmp")),
    false,
  );

  if (process.platform !== "win32") {
    await chmod(credentialsDir, 0o755);
    await chmod(credentialPath, 0o644);
    assert.equal(await store.getStatus(reference), "configured");
    assert.equal((await stat(credentialsDir)).mode & 0o777, 0o700);
    assert.equal((await stat(credentialPath)).mode & 0o777, 0o600);
  }

  await writeFile(credentialPath, '{"schemaVersion":1,"value":""}\n', {
    mode: 0o600,
  });
  await assert.rejects(
    store.getStatus(reference),
    (error) => assertStoreFailure(
      error,
      NODE_CONFIGURATION_STORE_FAILURE.credentialCorrupted,
    ),
  );
  await assert.rejects(
    store.use(reference, async () => undefined),
    (error) => assertStoreFailure(
      error,
      NODE_CONFIGURATION_STORE_FAILURE.credentialCorrupted,
    ),
  );

  const concurrentSecrets = Array.from(
    { length: 8 },
    (_, index) => `concurrent-secret-${index}`,
  );
  await Promise.all(concurrentSecrets.map((secret) =>
    new NodePlaintextCredentialStore({ homeResolver }).save(reference, secret)
  ));
  const concurrentResult = await store.use(reference, async (secret) => secret);
  assert.equal(concurrentSecrets.includes(concurrentResult), true);
  assert.equal(JSON.parse(await readFile(credentialPath, "utf8")).value, concurrentResult);

  await writeFile(lockPath, "active", { mode: 0o600 });
  const timeoutStore = new NodePlaintextCredentialStore({
    homeResolver,
    lockTimeoutMs: 30,
    staleLockMs: 60_000,
  });
  await assert.rejects(
    timeoutStore.save(reference, "lock-timeout-secret"),
    (error) => assertStoreFailure(
      error,
      NODE_CONFIGURATION_STORE_FAILURE.lockTimeout,
    ),
  );
  await unlink(lockPath);

  await writeFile(lockPath, "stale", { mode: 0o600 });
  const staleTime = new Date(Date.now() - 60_000);
  await utimes(lockPath, staleTime, staleTime);
  const staleRecoveryStore = new NodePlaintextCredentialStore({
    homeResolver,
    lockTimeoutMs: 1_000,
    staleLockMs: 10,
    logger,
  });
  await staleRecoveryStore.save(reference, "stale-lock-recovered-secret");
  assert.equal(
    await staleRecoveryStore.use(reference, async (secret) => secret),
    "stale-lock-recovered-secret",
  );

  await store.delete(reference);
  assert.equal(await store.getStatus(reference), "missing");
  await store.delete(reference);
  await assert.rejects(
    store.use(reference, async () => undefined),
    (error) => assertStoreFailure(
      error,
      NODE_CONFIGURATION_STORE_FAILURE.credentialMissing,
    ),
  );

  const serializedLogs = JSON.stringify(logger.entries);
  for (const forbidden of [
    temporaryRoot,
    credentialsDir,
    credentialPath,
    reference.id,
    firstSecret,
    secondSecret,
    "stale-lock-recovered-secret",
  ]) {
    assert.equal(serializedLogs.includes(forbidden), false, forbidden);
  }
  assert.equal(
    logger.entries.some((entry) =>
      entry.event === "configuration.credential.lock_recovered"
    ),
    true,
  );

  console.log("Node Plaintext Credential Store smoke passed");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function assertStoreFailure(error, failure) {
  assert.equal(error instanceof NodeConfigurationStoreError, true);
  assert.equal(error.failure, failure);
  return true;
}
