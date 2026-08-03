/** Resolves CLI/server credentials from explicitly bound environment variables. */
import {
  CredentialReference,
  type CredentialStatus,
  type CredentialVault,
} from "../../config/index.js";
import {
  NODE_CONFIGURATION_STORE_FAILURE,
  NodeConfigurationStoreError,
} from "./NodeConfigurationStoreErrors.js";

export interface EnvironmentCredentialVaultOptions {
  readonly bindings: Readonly<Record<string, string>>;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

export class EnvironmentCredentialVault implements CredentialVault {
  readonly #bindings: ReadonlyMap<string, string>;
  readonly #environment: Readonly<Record<string, string | undefined>>;

  constructor(options: EnvironmentCredentialVaultOptions) {
    const bindings = new Map<string, string>();
    for (const [referenceId, variableName] of Object.entries(options.bindings)) {
      const reference = new CredentialReference(referenceId);
      if (!/^[A-Z_][A-Z0-9_]{0,255}$/.test(variableName)) {
        throw new TypeError("Credential environment variable is invalid");
      }
      bindings.set(reference.id, variableName);
    }
    this.#bindings = bindings;
    this.#environment = options.environment ?? process.env;
    Object.freeze(this);
  }

  getStatus(reference: CredentialReference): Promise<CredentialStatus> {
    assertReference(reference);
    const variableName = this.#bindings.get(reference.id);
    const secret = variableName === undefined
      ? undefined
      : this.#environment[variableName];
    return Promise.resolve(secret === undefined || secret.length === 0
      ? "missing"
      : "configured");
  }

  async use<TResult>(
    reference: CredentialReference,
    operation: (secret: string) => Promise<TResult>,
  ): Promise<TResult> {
    assertReference(reference);
    const variableName = this.#bindings.get(reference.id);
    const secret = variableName === undefined
      ? undefined
      : this.#environment[variableName];
    if (secret === undefined || secret.length === 0) {
      throw new NodeConfigurationStoreError(
        NODE_CONFIGURATION_STORE_FAILURE.credentialMissing,
      );
    }
    return operation(secret);
  }
}

function assertReference(reference: CredentialReference): void {
  if (!(reference instanceof CredentialReference)) {
    throw new TypeError("Credential reference is invalid");
  }
}
