/** Loads layered Configuration and produces a secret-free Model execution descriptor. */
import type { ApplicationConfiguration } from "./ApplicationConfiguration.js";
import type {
  ApplicationConfigurationStore,
  CredentialStatusReader,
} from "./ConfigurationStore.js";
import {
  EffectiveConfigurationResolver,
  type EffectiveConfigurationSource,
} from "./EffectiveConfigurationResolver.js";
import {
  CredentialReference,
  type ModelApi,
  type ModelCapabilityOverridesSnapshot,
  type ModelParametersSnapshot,
  type ProviderKind,
} from "./ModelConfiguration.js";
import type {
  ConversationConfigurationBinding,
  SessionConfigurationOverrides,
  WorkspaceConfiguration,
} from "./ScopedConfiguration.js";
import { noopLogger, type Logger } from "../observability/index.js";

export const EFFECTIVE_MODEL_EXECUTION_SCHEMA_VERSION = 1 as const;

export const EFFECTIVE_MODEL_EXECUTION_FAILURE = Object.freeze({
  applicationConfigurationMissing: "application_configuration_missing",
  configurationUnavailable: "configuration_unavailable",
  modelProfileUnselected: "model_profile_unselected",
  modelProfileMissing: "model_profile_missing",
  modelConnectionMissing: "model_connection_missing",
  modelConnectionDisabled: "model_connection_disabled",
  modelApiUnsupported: "model_api_unsupported",
  credentialReferenceMissing: "credential_reference_missing",
  credentialMissing: "credential_missing",
  credentialUnavailable: "credential_unavailable",
} as const);

export type EffectiveModelExecutionFailure =
  (typeof EFFECTIVE_MODEL_EXECUTION_FAILURE)[keyof typeof EFFECTIVE_MODEL_EXECUTION_FAILURE];

export class EffectiveModelExecutionError extends Error {
  readonly failure: EffectiveModelExecutionFailure;
  readonly retryable: boolean;

  constructor(failure: EffectiveModelExecutionFailure, retryable = false) {
    super(`Effective Model execution is not ready: ${failure}`);
    this.name = "EffectiveModelExecutionError";
    this.failure = failure;
    this.retryable = retryable;
  }
}

export interface EffectiveModelExecutionDescriptor {
  readonly schemaVersion: typeof EFFECTIVE_MODEL_EXECUTION_SCHEMA_VERSION;
  readonly source: EffectiveConfigurationSource;
  readonly modelProfileId: string;
  readonly modelConnectionId: string;
  readonly providerKind: ProviderKind;
  readonly api: ModelApi;
  readonly modelId: string;
  readonly baseUrl?: string;
  readonly organizationId?: string;
  readonly projectId?: string;
  readonly apiVersion?: string;
  readonly region?: string;
  readonly parameters: ModelParametersSnapshot;
  readonly capabilityOverrides: ModelCapabilityOverridesSnapshot;
  readonly fallbackProfileIds: readonly string[];
  readonly publicHeaders: Readonly<Record<string, string>>;
  readonly credentialReference?: CredentialReference;
  readonly secretHeaderCredentialReferences: Readonly<
    Record<string, CredentialReference>
  >;
}

export interface EffectiveModelExecutionResolveRequest {
  readonly application: ApplicationConfigurationStore;
  readonly loadWorkspace?: () => Promise<WorkspaceConfiguration | undefined>;
  readonly loadConversation?: () => Promise<
    ConversationConfigurationBinding | undefined
  >;
  readonly loadSession?: () => Promise<SessionConfigurationOverrides | undefined>;
}

export interface EffectiveModelExecutionResolverOptions {
  readonly credentials: CredentialStatusReader;
  readonly supportedApis: ReadonlySet<string> | readonly string[];
  readonly configurationResolver?: EffectiveConfigurationResolver;
  readonly logger?: Logger;
}

export class EffectiveModelExecutionResolver {
  readonly #credentials: CredentialStatusReader;
  readonly #supportedApis: ReadonlySet<string>;
  readonly #configurationResolver: EffectiveConfigurationResolver;
  readonly #logger: Logger;

  constructor(options: EffectiveModelExecutionResolverOptions) {
    this.#credentials = options.credentials;
    this.#supportedApis = new Set(options.supportedApis);
    this.#configurationResolver = options.configurationResolver ??
      new EffectiveConfigurationResolver();
    this.#logger = (options.logger ?? noopLogger).child({
      component: "effective_model_execution_resolver",
    });
  }

  async resolve(
    request: EffectiveModelExecutionResolveRequest,
  ): Promise<EffectiveModelExecutionDescriptor> {
    this.#logger.debug("configuration.model_execution.resolve_started");
    const layers = await this.#loadLayers(request);
    const selected = selectModelProfileId(layers);
    if (selected === undefined) {
      throw failure(EFFECTIVE_MODEL_EXECUTION_FAILURE.modelProfileUnselected);
    }
    const modelProfile = layers.application.getModelProfile(selected.value);
    if (modelProfile === undefined) {
      throw failure(EFFECTIVE_MODEL_EXECUTION_FAILURE.modelProfileMissing);
    }
    const modelConnection = layers.application.getModelConnection(
      modelProfile.connectionId,
    );
    if (modelConnection === undefined) {
      throw failure(EFFECTIVE_MODEL_EXECUTION_FAILURE.modelConnectionMissing);
    }

    let effective;
    try {
      effective = this.#configurationResolver.resolve(layers);
    } catch {
      throw failure(EFFECTIVE_MODEL_EXECUTION_FAILURE.configurationUnavailable);
    }
    if (
      effective.modelProfile?.id !== modelProfile.id ||
      effective.modelConnection?.id !== modelConnection.id
    ) {
      throw failure(EFFECTIVE_MODEL_EXECUTION_FAILURE.configurationUnavailable);
    }
    if (!modelConnection.enabled) {
      throw failure(EFFECTIVE_MODEL_EXECUTION_FAILURE.modelConnectionDisabled);
    }
    if (!this.#supportedApis.has(modelProfile.api)) {
      throw failure(EFFECTIVE_MODEL_EXECUTION_FAILURE.modelApiUnsupported);
    }

    const secretHeaderCredentialReferences = Object.freeze(
      Object.fromEntries(
        Object.entries(modelConnection.secretHeaderCredentialRefs).map(
          ([header, reference]) => [header, new CredentialReference(reference)],
        ),
      ),
    );
    const requiredCredentials = uniqueCredentials([
      ...(modelConnection.credentialRef === undefined
        ? []
        : [modelConnection.credentialRef]),
      ...Object.values(secretHeaderCredentialReferences),
    ]);
    if (requiredCredentials.length === 0) {
      throw failure(EFFECTIVE_MODEL_EXECUTION_FAILURE.credentialReferenceMissing);
    }
    for (const reference of requiredCredentials) {
      const status = await this.#readCredentialStatus(reference);
      if (status === "missing") {
        throw failure(EFFECTIVE_MODEL_EXECUTION_FAILURE.credentialMissing, true);
      }
      if (status === "unavailable") {
        throw failure(EFFECTIVE_MODEL_EXECUTION_FAILURE.credentialUnavailable, true);
      }
    }

    const descriptor = Object.freeze({
      schemaVersion: EFFECTIVE_MODEL_EXECUTION_SCHEMA_VERSION,
      source: selected.source,
      modelProfileId: modelProfile.id,
      modelConnectionId: modelConnection.id,
      providerKind: modelConnection.providerKind,
      api: modelProfile.api,
      modelId: modelProfile.modelId,
      ...(modelConnection.baseUrl === undefined
        ? {}
        : { baseUrl: modelConnection.baseUrl }),
      ...(modelConnection.organizationId === undefined
        ? {}
        : { organizationId: modelConnection.organizationId }),
      ...(modelConnection.projectId === undefined
        ? {}
        : { projectId: modelConnection.projectId }),
      ...(modelConnection.apiVersion === undefined
        ? {}
        : { apiVersion: modelConnection.apiVersion }),
      ...(modelConnection.region === undefined
        ? {}
        : { region: modelConnection.region }),
      parameters: modelProfile.parameters.toSnapshot(),
      capabilityOverrides: modelProfile.capabilityOverrides.toSnapshot(),
      fallbackProfileIds: modelProfile.fallbackProfileIds,
      publicHeaders: modelConnection.publicHeaders,
      ...(modelConnection.credentialRef === undefined
        ? {}
        : { credentialReference: modelConnection.credentialRef }),
      secretHeaderCredentialReferences,
    });
    this.#logger.info("configuration.model_execution.resolve_completed", {
      source: descriptor.source,
    });
    return descriptor;
  }

  async #loadLayers(
    request: EffectiveModelExecutionResolveRequest,
  ): Promise<LoadedConfigurationLayers> {
    try {
      const [application, workspace, conversation, session] = await Promise.all([
        request.application.load(),
        request.loadWorkspace?.(),
        request.loadConversation?.(),
        request.loadSession?.(),
      ]);
      if (application === undefined) {
        throw failure(
          EFFECTIVE_MODEL_EXECUTION_FAILURE.applicationConfigurationMissing,
        );
      }
      return {
        application,
        ...(workspace === undefined ? {} : { workspace }),
        ...(conversation === undefined ? {} : { conversation }),
        ...(session === undefined ? {} : { session }),
      };
    } catch (error) {
      if (error instanceof EffectiveModelExecutionError) throw error;
      throw failure(
        EFFECTIVE_MODEL_EXECUTION_FAILURE.configurationUnavailable,
        true,
      );
    }
  }

  async #readCredentialStatus(reference: CredentialReference) {
    try {
      return await this.#credentials.getStatus(reference);
    } catch {
      throw failure(
        EFFECTIVE_MODEL_EXECUTION_FAILURE.credentialUnavailable,
        true,
      );
    }
  }
}

interface LoadedConfigurationLayers {
  readonly application: ApplicationConfiguration;
  readonly workspace?: WorkspaceConfiguration;
  readonly conversation?: ConversationConfigurationBinding;
  readonly session?: SessionConfigurationOverrides;
}

interface SelectedModelProfileId {
  readonly value: string;
  readonly source: EffectiveConfigurationSource;
}

function selectModelProfileId(
  layers: LoadedConfigurationLayers,
): SelectedModelProfileId | undefined {
  if (layers.session?.modelProfileId !== undefined) {
    return { value: layers.session.modelProfileId, source: "session" };
  }
  if (layers.conversation?.modelProfileId !== undefined) {
    return { value: layers.conversation.modelProfileId, source: "conversation" };
  }
  if (layers.workspace?.defaultModelProfileId !== undefined) {
    return { value: layers.workspace.defaultModelProfileId, source: "workspace" };
  }
  return layers.application.defaultModelProfileId === undefined
    ? undefined
    : { value: layers.application.defaultModelProfileId, source: "application" };
}

function uniqueCredentials(
  references: readonly CredentialReference[],
): readonly CredentialReference[] {
  return [...new Map(references.map((reference) => [reference.id, reference])).values()];
}

function failure(
  code: EffectiveModelExecutionFailure,
  retryable = false,
): EffectiveModelExecutionError {
  return new EffectiveModelExecutionError(code, retryable);
}
