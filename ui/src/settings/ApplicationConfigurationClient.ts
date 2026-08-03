/** Platform-neutral client for persisted non-secret Configuration and Host credentials. */
import type {
  ApplicationConfigurationSnapshot,
  CredentialStatus,
} from "@novel/core";

export interface ApplicationConfigurationClient {
  load(): Promise<ApplicationConfigurationSnapshot>;

  save(
    configuration: ApplicationConfigurationSnapshot,
  ): Promise<ApplicationConfigurationSnapshot>;

  getCredentialStatus(credentialRef: string): Promise<CredentialStatus>;

  saveCredential(credentialRef: string, secret: string): Promise<void>;

  deleteCredential(credentialRef: string): Promise<void>;
}
