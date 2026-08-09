import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CredentialReference } from "../dist/index.js";
import {
  EnvironmentCredentialVault,
  NODE_CONFIGURATION_STORE_FAILURE,
  NodeConfigurationHomeResolver,
  NodeConfigurationStoreError,
  NodeEncryptedCredentialStore,
} from "../dist/node/index.js";

class FakeCredentialCipher {
  available = true;
  shouldReEncrypt = false;

  async isAvailable() {
    return this.available;
  }

  async encrypt(secret) {
    return Buffer.from(`encrypted:${secret}`, "utf8").reverse();
  }

  async decrypt(encrypted) {
    const value = Buffer.from(encrypted).reverse().toString("utf8");
    if (!value.startsWith("encrypted:")) throw new Error("invalid");
    return {
      secret: value.slice("encrypted:".length),
      shouldReEncrypt: this.shouldReEncrypt,
    };
  }
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "novel-credential-store-"));
try {
  const homeResolver = new NodeConfigurationHomeResolver({ rootDir: temporaryRoot });
  const cipher = new FakeCredentialCipher();
  const store = new NodeEncryptedCredentialStore({ homeResolver, cipher });
  const reference = new CredentialReference("credential:primary");

  assert.equal(await store.getStatus(reference), "missing");
  await store.save(reference, "test-provider-secret");
  assert.equal(await store.getStatus(reference), "configured");
  const files = (await readdir(join(temporaryRoot, "credentials"))).filter(
    (name) => name.endsWith(".credential"),
  );
  assert.equal(files.length, 1);
  assert.equal(files[0].includes("credential:primary"), false);
  const credentialPath = join(temporaryRoot, "credentials", files[0]);
  const persisted = await readFile(credentialPath, "utf8");
  assert.equal(persisted.includes("test-provider-secret"), false);
  assert.equal(persisted.includes("credential:primary"), false);
  if (process.platform !== "win32") {
    assert.equal((await stat(credentialPath)).mode & 0o777, 0o600);
  }

  const secretLength = await new NodeEncryptedCredentialStore({
    homeResolver,
    cipher,
  }).use(reference, async (secret) => secret.length);
  assert.equal(secretLength, "test-provider-secret".length);

  cipher.shouldReEncrypt = true;
  assert.equal(await store.use(reference, async () => "used"), "used");
  cipher.shouldReEncrypt = false;

  await store.delete(reference);
  assert.equal(await store.getStatus(reference), "missing");
  await assert.rejects(
    store.use(reference, async () => undefined),
    (error) => {
      assert.equal(error instanceof NodeConfigurationStoreError, true);
      assert.equal(error.failure, NODE_CONFIGURATION_STORE_FAILURE.credentialMissing);
      return true;
    },
  );

  cipher.available = false;
  assert.equal(await store.getStatus(reference), "unavailable");
  await assert.rejects(
    store.save(reference, "unavailable-secret"),
    (error) => {
      assert.equal(error instanceof NodeConfigurationStoreError, true);
      assert.equal(error.failure, NODE_CONFIGURATION_STORE_FAILURE.credentialUnavailable);
      return true;
    },
  );

  const environmentReference = new CredentialReference("credential:environment");
  const environmentVault = new EnvironmentCredentialVault({
    bindings: { "credential:environment": "NOVEL_TEST_API_KEY" },
    environment: { NOVEL_TEST_API_KEY: "environment-secret" },
  });
  assert.equal(await environmentVault.getStatus(environmentReference), "configured");
  assert.equal(
    await environmentVault.use(environmentReference, async (secret) => secret.length),
    "environment-secret".length,
  );
  assert.equal(
    await environmentVault.getStatus(new CredentialReference("credential:missing")),
    "missing",
  );

  console.log("Node Credential Store smoke passed");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
