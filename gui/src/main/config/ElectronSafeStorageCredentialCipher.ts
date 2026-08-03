/** Adapts Electron safeStorage to the provider-neutral encrypted Credential Cipher. */
import type {
  CredentialCipher,
  CredentialCipherDecryptResult,
} from "@novel/core/node";

export type ElectronSafeStorageBackend =
  | "basic_text"
  | "gnome_libsecret"
  | "kwallet"
  | "kwallet5"
  | "kwallet6"
  | "unknown";

export interface ElectronSafeStoragePort {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  getSelectedStorageBackend(): ElectronSafeStorageBackend;
  encryptStringAsync(plainText: string): Promise<Buffer>;
  decryptStringAsync(encrypted: Buffer): Promise<{
    readonly result: string;
    readonly shouldReEncrypt: boolean;
  }>;
}

export interface ElectronSafeStorageCredentialCipherOptions {
  readonly safeStorage: ElectronSafeStoragePort;
  readonly platform?: NodeJS.Platform;
}

export class ElectronSafeStorageCredentialCipher implements CredentialCipher {
  readonly #safeStorage: ElectronSafeStoragePort;
  readonly #platform: NodeJS.Platform;

  constructor(options: ElectronSafeStorageCredentialCipherOptions) {
    this.#safeStorage = options.safeStorage;
    this.#platform = options.platform ?? process.platform;
  }

  async isAvailable(): Promise<boolean> {
    if (!(await this.#safeStorage.isAsyncEncryptionAvailable())) return false;
    if (this.#platform !== "linux") return true;
    const backend = this.#safeStorage.getSelectedStorageBackend();
    return backend !== "basic_text" && backend !== "unknown";
  }

  async encrypt(secret: string): Promise<Uint8Array> {
    if (!(await this.isAvailable())) {
      throw new Error("Electron credential encryption is unavailable");
    }
    return this.#safeStorage.encryptStringAsync(secret);
  }

  async decrypt(encrypted: Uint8Array): Promise<CredentialCipherDecryptResult> {
    if (!(await this.isAvailable())) {
      throw new Error("Electron credential encryption is unavailable");
    }
    const result = await this.#safeStorage.decryptStringAsync(Buffer.from(encrypted));
    return Object.freeze({
      secret: result.result,
      shouldReEncrypt: result.shouldReEncrypt,
    });
  }
}
