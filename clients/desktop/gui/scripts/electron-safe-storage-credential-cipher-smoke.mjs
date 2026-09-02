import assert from "node:assert/strict";
import { ElectronSafeStorageCredentialCipher } from "../dist/main/index.js";

class FakeSafeStorage {
  available = true;
  backend = "gnome_libsecret";
  shouldReEncrypt = false;

  async isAsyncEncryptionAvailable() {
    return this.available;
  }

  getSelectedStorageBackend() {
    return this.backend;
  }

  async encryptStringAsync(value) {
    return Buffer.from(`safe:${value}`, "utf8");
  }

  async decryptStringAsync(value) {
    return {
      result: value.toString("utf8").slice("safe:".length),
      shouldReEncrypt: this.shouldReEncrypt,
    };
  }
}

const safeStorage = new FakeSafeStorage();
const linuxCipher = new ElectronSafeStorageCredentialCipher({
  safeStorage,
  platform: "linux",
});
assert.equal(await linuxCipher.isAvailable(), true);
const encrypted = await linuxCipher.encrypt("provider-secret");
assert.equal(Buffer.from(encrypted).toString("utf8"), "safe:provider-secret");
assert.deepEqual(await linuxCipher.decrypt(encrypted), {
  secret: "provider-secret",
  shouldReEncrypt: false,
});

safeStorage.backend = "basic_text";
assert.equal(await linuxCipher.isAvailable(), false);
await assert.rejects(linuxCipher.encrypt("forbidden"), /unavailable/);

safeStorage.backend = "unknown";
assert.equal(await linuxCipher.isAvailable(), false);

safeStorage.available = false;
const macCipher = new ElectronSafeStorageCredentialCipher({
  safeStorage,
  platform: "darwin",
});
assert.equal(await macCipher.isAvailable(), false);

safeStorage.available = true;
safeStorage.shouldReEncrypt = true;
assert.deepEqual(await macCipher.decrypt(Buffer.from("safe:rotated", "utf8")), {
  secret: "rotated",
  shouldReEncrypt: true,
});

console.log("Electron safeStorage Credential Cipher smoke passed");
