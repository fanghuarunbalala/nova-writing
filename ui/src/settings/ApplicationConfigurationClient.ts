/** Platform-neutral client for persisted non-secret Configuration and Host credentials. */
import type {
  ApplicationConfigurationSnapshot,
  CredentialStatus,
  RemoveModelConfigurationRequest,
  RemoveModelConfigurationResult,
  SetDefaultModelProfileRequest,
  SetDefaultModelProfileResult,
  UpsertModelConfigurationRequest,
  UpsertModelConfigurationResult,
} from "@novel/core";

export interface ApplicationConfigurationClient {
  load(): Promise<ApplicationConfigurationSnapshot>;

  save(
    configuration: ApplicationConfigurationSnapshot,
  ): Promise<ApplicationConfigurationSnapshot>;

  upsertModelConfiguration(
    request: UpsertModelConfigurationRequest,
  ): Promise<UpsertModelConfigurationResult>;

  setDefaultModelProfile(
    request: SetDefaultModelProfileRequest,
  ): Promise<SetDefaultModelProfileResult>;

  removeModelConfiguration(
    request: RemoveModelConfigurationRequest,
  ): Promise<RemoveModelConfigurationResult>;

  getCredentialStatus(credentialRef: string): Promise<CredentialStatus>;

  saveCredential(credentialRef: string, secret: string): Promise<void>;

  deleteCredential(credentialRef: string): Promise<void>;
}
