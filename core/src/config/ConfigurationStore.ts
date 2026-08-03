/** Asynchronous provider-neutral Configuration and credential persistence Ports. */
import type { ApplicationConfiguration } from "./ApplicationConfiguration.js";
import type { WorkspaceConfiguration } from "./ScopedConfiguration.js";
import type { CredentialReference } from "./ModelConfiguration.js";

export interface ApplicationConfigurationStore {
  load(): Promise<ApplicationConfiguration | undefined>;
  save(
    configuration: ApplicationConfiguration,
    expectedRevision?: number,
  ): Promise<void>;
}

export interface WorkspaceConfigurationStore {
  load(workspaceId: string): Promise<WorkspaceConfiguration | undefined>;
  save(
    configuration: WorkspaceConfiguration,
    expectedRevision?: number,
  ): Promise<void>;
}

export type CredentialStatus = "missing" | "configured" | "unavailable";

export interface CredentialStore {
  save(reference: CredentialReference, secret: string): Promise<void>;
  getStatus(reference: CredentialReference): Promise<CredentialStatus>;
  delete(reference: CredentialReference): Promise<void>;
}

export interface ConfigurationHome {
  readonly rootDir: string;
  readonly configDir: string;
  readonly credentialsDir: string;
  readonly cacheDir: string;
  readonly logsDir: string;
  readonly diagnosticsDir: string;
}

export interface ConfigurationHomeResolver {
  resolve(): Promise<ConfigurationHome>;
}
