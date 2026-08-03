/** Serializable Model Configuration commands captured at trusted Host boundaries. */
import type { ApplicationConfigurationSnapshot } from "./ApplicationConfiguration.js";
import {
  ModelCapabilityOverrides,
  ModelConnection,
  ModelParameters,
  type ModelApi,
  type ModelCapabilityOverridesSnapshot,
  type ModelParametersSnapshot,
  type ProviderKind,
} from "./ModelConfiguration.js";
import type { CredentialStatus } from "./ConfigurationStore.js";
import {
  captureBoolean,
  captureIdentity,
  captureIdentityList,
  captureInteger,
  captureNonBlank,
  freezeSnapshot,
} from "./ConfigurationValues.js";

export const MODEL_CONFIGURATION_COMMAND_SCHEMA_VERSION = 1 as const;

export const MODEL_CREDENTIAL_MUTATION_KIND = Object.freeze({
  keep: "keep",
  replace: "replace",
  delete: "delete",
} as const);

export type ModelCredentialMutationKind =
  (typeof MODEL_CREDENTIAL_MUTATION_KIND)[keyof typeof MODEL_CREDENTIAL_MUTATION_KIND];

export interface KeepModelCredentialMutation {
  readonly kind: "keep";
}

export interface ReplaceModelCredentialMutation {
  readonly kind: "replace";
  readonly secret: string;
}

export interface DeleteModelCredentialMutation {
  readonly kind: "delete";
}

export type ModelCredentialMutation =
  | KeepModelCredentialMutation
  | ReplaceModelCredentialMutation
  | DeleteModelCredentialMutation;

export interface ModelConnectionCommandInput {
  readonly id?: string;
  readonly displayName: string;
  readonly providerKind: ProviderKind;
  readonly baseUrl?: string;
  readonly organizationId?: string;
  readonly projectId?: string;
  readonly apiVersion?: string;
  readonly region?: string;
  readonly enabled: boolean;
  readonly publicHeaders: Readonly<Record<string, string>>;
  readonly secretHeaderCredentialRefs: Readonly<Record<string, string>>;
}

export interface ModelProfileCommandInput {
  readonly id?: string;
  readonly displayName: string;
  readonly api: ModelApi;
  readonly modelId: string;
  readonly parameters: ModelParametersSnapshot;
  readonly capabilityOverrides: ModelCapabilityOverridesSnapshot;
  readonly fallbackProfileIds: readonly string[];
}

export interface UpsertModelConfigurationRequest {
  readonly schemaVersion: typeof MODEL_CONFIGURATION_COMMAND_SCHEMA_VERSION;
  readonly expectedRevision: number;
  readonly connection: ModelConnectionCommandInput;
  readonly profile: ModelProfileCommandInput;
  readonly credential: ModelCredentialMutation;
  readonly setAsDefault: boolean;
}

export interface SetDefaultModelProfileRequest {
  readonly schemaVersion: typeof MODEL_CONFIGURATION_COMMAND_SCHEMA_VERSION;
  readonly expectedRevision: number;
  readonly modelProfileId: string;
}

export interface RemoveModelConfigurationRequest {
  readonly schemaVersion: typeof MODEL_CONFIGURATION_COMMAND_SCHEMA_VERSION;
  readonly expectedRevision: number;
  readonly modelProfileId: string;
  readonly removeConnectionWhenUnused: boolean;
}

export const MODEL_CREDENTIAL_CLEANUP_STATUS = Object.freeze({
  notRequired: "not_required",
  completed: "completed",
  deferred: "deferred",
} as const);

export type ModelCredentialCleanupStatus =
  (typeof MODEL_CREDENTIAL_CLEANUP_STATUS)[keyof typeof MODEL_CREDENTIAL_CLEANUP_STATUS];

export interface UpsertModelConfigurationResult {
  readonly schemaVersion: typeof MODEL_CONFIGURATION_COMMAND_SCHEMA_VERSION;
  readonly configuration: ApplicationConfigurationSnapshot;
  readonly connectionId: string;
  readonly modelProfileId: string;
  readonly credentialStatus: CredentialStatus;
  readonly credentialCleanupStatus: ModelCredentialCleanupStatus;
}

export interface SetDefaultModelProfileResult {
  readonly schemaVersion: typeof MODEL_CONFIGURATION_COMMAND_SCHEMA_VERSION;
  readonly configuration: ApplicationConfigurationSnapshot;
}

export interface RemoveModelConfigurationResult {
  readonly schemaVersion: typeof MODEL_CONFIGURATION_COMMAND_SCHEMA_VERSION;
  readonly configuration: ApplicationConfigurationSnapshot;
  readonly removedModelProfileId: string;
  readonly removedConnectionId?: string;
  readonly credentialCleanupStatus: ModelCredentialCleanupStatus;
}

export function captureUpsertModelConfigurationRequest(
  value: UpsertModelConfigurationRequest,
): UpsertModelConfigurationRequest {
  assertSchemaVersion(value?.schemaVersion);
  return freezeSnapshot({
    schemaVersion: MODEL_CONFIGURATION_COMMAND_SCHEMA_VERSION,
    expectedRevision: captureRevision(value.expectedRevision),
    connection: captureConnection(value.connection),
    profile: captureProfile(value.profile),
    credential: captureCredentialMutation(value.credential),
    setAsDefault: captureBoolean(value.setAsDefault, "Set as default Model"),
  });
}

export function captureSetDefaultModelProfileRequest(
  value: SetDefaultModelProfileRequest,
): SetDefaultModelProfileRequest {
  assertSchemaVersion(value?.schemaVersion);
  return freezeSnapshot({
    schemaVersion: MODEL_CONFIGURATION_COMMAND_SCHEMA_VERSION,
    expectedRevision: captureRevision(value.expectedRevision),
    modelProfileId: captureIdentity(value.modelProfileId, "Model Profile ID"),
  });
}

export function captureRemoveModelConfigurationRequest(
  value: RemoveModelConfigurationRequest,
): RemoveModelConfigurationRequest {
  assertSchemaVersion(value?.schemaVersion);
  return freezeSnapshot({
    schemaVersion: MODEL_CONFIGURATION_COMMAND_SCHEMA_VERSION,
    expectedRevision: captureRevision(value.expectedRevision),
    modelProfileId: captureIdentity(value.modelProfileId, "Model Profile ID"),
    removeConnectionWhenUnused: captureBoolean(
      value.removeConnectionWhenUnused,
      "Remove unused Model Connection",
    ),
  });
}

function captureConnection(
  value: ModelConnectionCommandInput,
): ModelConnectionCommandInput {
  if (value === null || typeof value !== "object") {
    throw new TypeError("Model Connection command input is invalid");
  }
  const captured = new ModelConnection({
    id: value.id ?? "model-connection:pending",
    displayName: value.displayName,
    providerKind: value.providerKind,
    ...(value.baseUrl === undefined ? {} : { baseUrl: value.baseUrl }),
    ...(value.organizationId === undefined
      ? {}
      : { organizationId: value.organizationId }),
    ...(value.projectId === undefined ? {} : { projectId: value.projectId }),
    ...(value.apiVersion === undefined ? {} : { apiVersion: value.apiVersion }),
    ...(value.region === undefined ? {} : { region: value.region }),
    enabled: value.enabled,
    credentialConfigured: false,
    publicHeaders: value.publicHeaders,
    secretHeaderCredentialRefs: value.secretHeaderCredentialRefs,
  });
  const snapshot = captured.toSnapshot();
  return freezeSnapshot({
    ...(value.id === undefined ? {} : { id: captured.id }),
    displayName: captured.displayName,
    providerKind: captured.providerKind,
    ...(captured.baseUrl === undefined ? {} : { baseUrl: captured.baseUrl }),
    ...(captured.organizationId === undefined
      ? {}
      : { organizationId: captured.organizationId }),
    ...(captured.projectId === undefined ? {} : { projectId: captured.projectId }),
    ...(captured.apiVersion === undefined ? {} : { apiVersion: captured.apiVersion }),
    ...(captured.region === undefined ? {} : { region: captured.region }),
    enabled: captured.enabled,
    publicHeaders: snapshot.publicHeaders,
    secretHeaderCredentialRefs: snapshot.secretHeaderCredentialRefs,
  });
}

function captureProfile(value: ModelProfileCommandInput): ModelProfileCommandInput {
  if (value === null || typeof value !== "object") {
    throw new TypeError("Model Profile command input is invalid");
  }
  const parameters = new ModelParameters(value.parameters);
  const capabilities = new ModelCapabilityOverrides(value.capabilityOverrides);
  return freezeSnapshot({
    ...(value.id === undefined
      ? {}
      : { id: captureIdentity(value.id, "Model Profile ID") }),
    displayName: captureNonBlank(value.displayName, "Model Profile name", 256),
    api: captureNonBlank(value.api, "Model API", 256),
    modelId: captureNonBlank(value.modelId, "Model ID", 512),
    parameters: parameters.toSnapshot(),
    capabilityOverrides: capabilities.toSnapshot(),
    fallbackProfileIds: captureIdentityList(
      value.fallbackProfileIds,
      "Fallback Model Profile ID",
      16,
    ),
  });
}

function captureCredentialMutation(
  value: ModelCredentialMutation,
): ModelCredentialMutation {
  if (value === null || typeof value !== "object") {
    throw new TypeError("Model Credential mutation is invalid");
  }
  if (value.kind === MODEL_CREDENTIAL_MUTATION_KIND.keep) {
    return Object.freeze({ kind: MODEL_CREDENTIAL_MUTATION_KIND.keep });
  }
  if (value.kind === MODEL_CREDENTIAL_MUTATION_KIND.delete) {
    return Object.freeze({ kind: MODEL_CREDENTIAL_MUTATION_KIND.delete });
  }
  if (value.kind === MODEL_CREDENTIAL_MUTATION_KIND.replace) {
    if (
      typeof value.secret !== "string" ||
      value.secret.length === 0 ||
      value.secret.length > 1_048_576
    ) {
      throw new TypeError("Model Credential secret is invalid");
    }
    return Object.freeze({
      kind: MODEL_CREDENTIAL_MUTATION_KIND.replace,
      secret: value.secret,
    });
  }
  throw new TypeError("Model Credential mutation kind is invalid");
}

function assertSchemaVersion(value: unknown): void {
  if (value !== MODEL_CONFIGURATION_COMMAND_SCHEMA_VERSION) {
    throw new TypeError("Model Configuration command schema version is unsupported");
  }
}

function captureRevision(value: unknown): number {
  return captureInteger(value, "Expected Configuration revision", 0, 2_147_483_647);
}
