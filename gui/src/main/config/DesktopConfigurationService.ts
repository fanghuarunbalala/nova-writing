/** Owns persisted Application Configuration and Host-only Credential operations. */
import {
  ApplicationConfiguration,
  CredentialReference,
  createDefaultApplicationConfiguration,
  type ApplicationConfigurationSnapshot,
  type ApplicationConfigurationStore,
  type CredentialStatus,
  type CredentialStore,
} from "@novel/core";

export interface DesktopConfigurationServicePort {
  load(): Promise<ApplicationConfigurationSnapshot>;
  save(
    snapshot: ApplicationConfigurationSnapshot,
  ): Promise<ApplicationConfigurationSnapshot>;
  getCredentialStatus(credentialRef: string): Promise<CredentialStatus>;
  saveCredential(credentialRef: string, secret: string): Promise<void>;
  deleteCredential(credentialRef: string): Promise<void>;
}

export interface DesktopConfigurationServiceOptions {
  readonly store: ApplicationConfigurationStore;
  readonly credentials: CredentialStore;
}

export class DesktopConfigurationService
  implements DesktopConfigurationServicePort
{
  readonly #store: ApplicationConfigurationStore;
  readonly #credentials: CredentialStore;
  #current?: Promise<ApplicationConfiguration>;
  #mutationTail: Promise<void> = Promise.resolve();

  constructor(options: DesktopConfigurationServiceOptions) {
    this.#store = options.store;
    this.#credentials = options.credentials;
  }

  async load(): Promise<ApplicationConfigurationSnapshot> {
    return this.#project(await this.#loadCurrent());
  }

  save(
    snapshot: ApplicationConfigurationSnapshot,
  ): Promise<ApplicationConfigurationSnapshot> {
    return this.#mutate(async () => {
      const current = await this.#loadCurrent();
      const next = new ApplicationConfiguration(snapshot);
      if (next.revision !== current.revision + 1) {
        throw new DesktopConfigurationProtocolError();
      }
      await this.#store.save(next, current.revision);
      this.#current = Promise.resolve(next);
      return this.#project(next);
    });
  }

  async getCredentialStatus(credentialRef: string): Promise<CredentialStatus> {
    const reference = await this.#requireCredentialReference(credentialRef);
    return this.#credentials.getStatus(reference);
  }

  async saveCredential(credentialRef: string, secret: string): Promise<void> {
    const reference = await this.#requireCredentialReference(credentialRef);
    await this.#credentials.save(reference, secret);
  }

  async deleteCredential(credentialRef: string): Promise<void> {
    const reference = await this.#requireCredentialReference(credentialRef);
    await this.#credentials.delete(reference);
  }

  #loadCurrent(): Promise<ApplicationConfiguration> {
    this.#current ??= this.#store.load().then(async (configuration) => {
      if (configuration !== undefined) return configuration;
      const defaults = createDefaultApplicationConfiguration();
      await this.#store.save(defaults);
      return defaults;
    });
    return this.#current;
  }

  #mutate<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
    const result = this.#mutationTail.then(operation, operation);
    this.#mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  async #project(
    configuration: ApplicationConfiguration,
  ): Promise<ApplicationConfigurationSnapshot> {
    const snapshot = configuration.toSnapshot();
    const modelConnections = await Promise.all(
      configuration.modelConnections.map(async (connection) => {
        const reference = connection.credentialRef;
        const credentialConfigured = reference === undefined
          ? false
          : (await this.#credentials.getStatus(reference)) === "configured";
        return Object.freeze({
          ...connection.toSnapshot(),
          credentialConfigured,
        });
      }),
    );
    return Object.freeze({
      ...snapshot,
      modelConnections: Object.freeze(modelConnections),
    });
  }

  async #requireCredentialReference(value: string): Promise<CredentialReference> {
    const reference = new CredentialReference(value);
    const configuration = await this.#loadCurrent();
    const allowed = new Set<string>();
    if (configuration.network.proxyCredentialRef !== undefined) {
      allowed.add(configuration.network.proxyCredentialRef);
    }
    for (const connection of configuration.modelConnections) {
      if (connection.credentialRef !== undefined) allowed.add(connection.credentialRef.id);
      for (const headerReference of Object.values(
        connection.secretHeaderCredentialRefs,
      )) {
        allowed.add(headerReference);
      }
    }
    if (!allowed.has(reference.id)) throw new DesktopConfigurationProtocolError();
    return reference;
  }
}

class DesktopConfigurationProtocolError extends Error {
  readonly code = "DESKTOP_CONFIGURATION_PROTOCOL_ERROR";
}
