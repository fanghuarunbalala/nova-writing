/** Provider-neutral model connections and model profiles without persisted secrets. */
import {
  captureBoolean,
  captureIdentity,
  captureIdentityList,
  captureNonBlank,
  captureOptionalInteger,
  captureOptionalNonBlank,
  captureOptionalNumber,
  captureScalarRecord,
  captureStringRecord,
  captureStringList,
  freezeSnapshot,
  type JsonScalar,
} from "./ConfigurationValues.js";

export type ProviderKind =
  | "openai"
  | "anthropic"
  | "google"
  | "openrouter"
  | "openai_compatible"
  | "custom";

export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

export class CredentialReference {
  readonly id: string;

  constructor(id: string) {
    this.id = captureIdentity(id, "Credential reference");
    Object.freeze(this);
  }

  toString(): string {
    return this.id;
  }
}

export interface ModelConnectionSnapshot {
  readonly id: string;
  readonly displayName: string;
  readonly providerKind: ProviderKind;
  readonly baseUrl?: string;
  readonly organizationId?: string;
  readonly projectId?: string;
  readonly apiVersion?: string;
  readonly region?: string;
  readonly enabled: boolean;
  readonly credentialRef?: string;
  readonly credentialConfigured: boolean;
  readonly publicHeaders: Readonly<Record<string, string>>;
  readonly secretHeaderCredentialRefs: Readonly<Record<string, string>>;
}

export class ModelConnection {
  readonly id: string;
  readonly displayName: string;
  readonly providerKind: ProviderKind;
  readonly baseUrl?: string;
  readonly organizationId?: string;
  readonly projectId?: string;
  readonly apiVersion?: string;
  readonly region?: string;
  readonly enabled: boolean;
  readonly credentialRef?: CredentialReference;
  readonly credentialConfigured: boolean;
  readonly publicHeaders: Readonly<Record<string, string>>;
  readonly secretHeaderCredentialRefs: Readonly<Record<string, string>>;

  constructor(options: ModelConnectionSnapshot) {
    this.id = captureIdentity(options.id, "Model Connection ID");
    this.displayName = captureNonBlank(
      options.displayName,
      "Model Connection name",
      256,
    );
    this.providerKind = captureProviderKind(options.providerKind);
    this.baseUrl = captureOptionalNonBlank(options.baseUrl, "Base URL", 4_096);
    this.organizationId = captureOptionalNonBlank(
      options.organizationId,
      "Organization ID",
      256,
    );
    this.projectId = captureOptionalNonBlank(options.projectId, "Project ID", 256);
    this.apiVersion = captureOptionalNonBlank(options.apiVersion, "API version", 128);
    this.region = captureOptionalNonBlank(options.region, "Region", 128);
    this.enabled = captureBoolean(options.enabled, "Model Connection enabled");
    this.credentialRef = options.credentialRef === undefined
      ? undefined
      : new CredentialReference(options.credentialRef);
    this.credentialConfigured = captureBoolean(
      options.credentialConfigured,
      "Credential configured",
    );
    this.publicHeaders = captureStringRecord(options.publicHeaders, "Public headers");
    this.secretHeaderCredentialRefs = captureStringRecord(
      options.secretHeaderCredentialRefs,
      "Secret header credential references",
    );
    if (
      this.credentialConfigured &&
      this.credentialRef === undefined &&
      Object.keys(this.secretHeaderCredentialRefs).length === 0
    ) {
      throw new TypeError("Configured credentials require a credential reference");
    }
    if (
      (this.providerKind === "openai_compatible" || this.providerKind === "custom") &&
      this.baseUrl === undefined
    ) {
      throw new TypeError("Custom Model Connection requires a Base URL");
    }
    Object.freeze(this);
  }

  toSnapshot(): ModelConnectionSnapshot {
    return freezeSnapshot({
      id: this.id,
      displayName: this.displayName,
      providerKind: this.providerKind,
      ...(this.baseUrl === undefined ? {} : { baseUrl: this.baseUrl }),
      ...(this.organizationId === undefined
        ? {}
        : { organizationId: this.organizationId }),
      ...(this.projectId === undefined ? {} : { projectId: this.projectId }),
      ...(this.apiVersion === undefined ? {} : { apiVersion: this.apiVersion }),
      ...(this.region === undefined ? {} : { region: this.region }),
      enabled: this.enabled,
      ...(this.credentialRef === undefined
        ? {}
        : { credentialRef: this.credentialRef.id }),
      credentialConfigured: this.credentialConfigured,
      publicHeaders: this.publicHeaders,
      secretHeaderCredentialRefs: this.secretHeaderCredentialRefs,
    });
  }
}

export interface ModelParametersSnapshot {
  readonly maximumOutputTokens?: number;
  readonly temperature?: number;
  readonly topP?: number;
  readonly reasoningEffort?: ReasoningEffort;
  readonly thinkingBudgetTokens?: number;
  readonly seed?: number;
  readonly stopSequences: readonly string[];
  readonly providerOptions: Readonly<Record<string, JsonScalar>>;
}

export class ModelParameters {
  readonly maximumOutputTokens?: number;
  readonly temperature?: number;
  readonly topP?: number;
  readonly reasoningEffort?: ReasoningEffort;
  readonly thinkingBudgetTokens?: number;
  readonly seed?: number;
  readonly stopSequences: readonly string[];
  readonly providerOptions: Readonly<Record<string, JsonScalar>>;

  constructor(options: ModelParametersSnapshot) {
    this.maximumOutputTokens = captureOptionalInteger(
      options.maximumOutputTokens,
      "Maximum output tokens",
      1,
      10_000_000,
    );
    this.temperature = captureOptionalNumber(options.temperature, "Temperature", 0, 2);
    this.topP = captureOptionalNumber(options.topP, "Top P", 0, 1);
    this.reasoningEffort = options.reasoningEffort === undefined
      ? undefined
      : captureReasoningEffort(options.reasoningEffort);
    this.thinkingBudgetTokens = captureOptionalInteger(
      options.thinkingBudgetTokens,
      "Thinking budget",
      1,
      10_000_000,
    );
    this.seed = captureOptionalInteger(
      options.seed,
      "Model seed",
      -2_147_483_648,
      2_147_483_647,
    );
    this.stopSequences = captureStringList(options.stopSequences, "Stop sequence", 32);
    this.providerOptions = captureScalarRecord(
      options.providerOptions,
      "Provider options",
    );
    Object.freeze(this);
  }

  toSnapshot(): ModelParametersSnapshot {
    return freezeSnapshot({
      ...(this.maximumOutputTokens === undefined
        ? {}
        : { maximumOutputTokens: this.maximumOutputTokens }),
      ...(this.temperature === undefined ? {} : { temperature: this.temperature }),
      ...(this.topP === undefined ? {} : { topP: this.topP }),
      ...(this.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: this.reasoningEffort }),
      ...(this.thinkingBudgetTokens === undefined
        ? {}
        : { thinkingBudgetTokens: this.thinkingBudgetTokens }),
      ...(this.seed === undefined ? {} : { seed: this.seed }),
      stopSequences: this.stopSequences,
      providerOptions: this.providerOptions,
    });
  }
}

export interface ModelCapabilityOverridesSnapshot {
  readonly contextWindowTokens?: number;
  readonly toolCalling?: boolean;
  readonly imageInput?: boolean;
  readonly audioInput?: boolean;
  readonly promptCache?: boolean;
}

export class ModelCapabilityOverrides {
  readonly contextWindowTokens?: number;
  readonly toolCalling?: boolean;
  readonly imageInput?: boolean;
  readonly audioInput?: boolean;
  readonly promptCache?: boolean;

  constructor(options: ModelCapabilityOverridesSnapshot = {}) {
    this.contextWindowTokens = captureOptionalInteger(
      options.contextWindowTokens,
      "Context window",
      1,
      100_000_000,
    );
    this.toolCalling = captureOptionalBoolean(options.toolCalling, "Tool calling");
    this.imageInput = captureOptionalBoolean(options.imageInput, "Image input");
    this.audioInput = captureOptionalBoolean(options.audioInput, "Audio input");
    this.promptCache = captureOptionalBoolean(options.promptCache, "Prompt cache");
    Object.freeze(this);
  }

  toSnapshot(): ModelCapabilityOverridesSnapshot {
    return freezeSnapshot({
      ...(this.contextWindowTokens === undefined
        ? {}
        : { contextWindowTokens: this.contextWindowTokens }),
      ...(this.toolCalling === undefined ? {} : { toolCalling: this.toolCalling }),
      ...(this.imageInput === undefined ? {} : { imageInput: this.imageInput }),
      ...(this.audioInput === undefined ? {} : { audioInput: this.audioInput }),
      ...(this.promptCache === undefined ? {} : { promptCache: this.promptCache }),
    });
  }
}

export interface ModelProfileSnapshot {
  readonly id: string;
  readonly displayName: string;
  readonly connectionId: string;
  readonly modelId: string;
  readonly parameters: ModelParametersSnapshot;
  readonly capabilityOverrides: ModelCapabilityOverridesSnapshot;
  readonly fallbackProfileIds: readonly string[];
}

export class ModelProfile {
  readonly id: string;
  readonly displayName: string;
  readonly connectionId: string;
  readonly modelId: string;
  readonly parameters: ModelParameters;
  readonly capabilityOverrides: ModelCapabilityOverrides;
  readonly fallbackProfileIds: readonly string[];

  constructor(options: ModelProfileSnapshot) {
    this.id = captureIdentity(options.id, "Model Profile ID");
    this.displayName = captureNonBlank(options.displayName, "Model Profile name", 256);
    this.connectionId = captureIdentity(options.connectionId, "Model Connection ID");
    this.modelId = captureNonBlank(options.modelId, "Model ID", 512);
    this.parameters = new ModelParameters(options.parameters);
    this.capabilityOverrides = new ModelCapabilityOverrides(options.capabilityOverrides);
    this.fallbackProfileIds = captureIdentityList(
      options.fallbackProfileIds,
      "Fallback Model Profile ID",
      16,
    );
    if (this.fallbackProfileIds.includes(this.id)) {
      throw new TypeError("Model Profile cannot fall back to itself");
    }
    Object.freeze(this);
  }

  toSnapshot(): ModelProfileSnapshot {
    return freezeSnapshot({
      id: this.id,
      displayName: this.displayName,
      connectionId: this.connectionId,
      modelId: this.modelId,
      parameters: this.parameters.toSnapshot(),
      capabilityOverrides: this.capabilityOverrides.toSnapshot(),
      fallbackProfileIds: this.fallbackProfileIds,
    });
  }
}

function captureProviderKind(value: unknown): ProviderKind {
  if (
    value !== "openai" &&
    value !== "anthropic" &&
    value !== "google" &&
    value !== "openrouter" &&
    value !== "openai_compatible" &&
    value !== "custom"
  ) {
    throw new TypeError("Provider kind is invalid");
  }
  return value;
}

function captureReasoningEffort(value: unknown): ReasoningEffort {
  if (
    value !== "minimal" &&
    value !== "low" &&
    value !== "medium" &&
    value !== "high" &&
    value !== "xhigh"
  ) {
    throw new TypeError("Reasoning effort is invalid");
  }
  return value;
}

function captureOptionalBoolean(value: unknown, label: string): boolean | undefined {
  return value === undefined ? undefined : captureBoolean(value, label);
}
