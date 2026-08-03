/** Coordinates revisioned Model Configuration mutations and staged credentials. */
import {
  ApplicationConfiguration,
  createDefaultApplicationConfiguration,
} from "./ApplicationConfiguration.js";
import {
  MODEL_CONFIGURATION_COMMAND_SCHEMA_VERSION,
  MODEL_CREDENTIAL_CLEANUP_STATUS,
  MODEL_CREDENTIAL_MUTATION_KIND,
  captureRemoveModelConfigurationRequest,
  captureSetDefaultModelProfileRequest,
  captureUpsertModelConfigurationRequest,
  type ModelCredentialCleanupStatus,
  type RemoveModelConfigurationRequest,
  type RemoveModelConfigurationResult,
  type SetDefaultModelProfileRequest,
  type SetDefaultModelProfileResult,
  type UpsertModelConfigurationRequest,
  type UpsertModelConfigurationResult,
} from "./ModelConfigurationCommand.js";
import {
  CredentialReference,
  ModelConnection,
  ModelProfile,
} from "./ModelConfiguration.js";
import type {
  ApplicationConfigurationStore,
  CredentialStatus,
  CredentialStore,
} from "./ConfigurationStore.js";
import { noopLogger, type Logger } from "../observability/index.js";

export const MODEL_CONFIGURATION_COMMAND_FAILURE = Object.freeze({
  revisionConflict: "revision_conflict",
  modelProfileMissing: "model_profile_missing",
  modelConnectionMismatch: "model_connection_mismatch",
  modelProfileReferenced: "model_profile_referenced",
  credentialCompensationFailed: "credential_compensation_failed",
} as const);

export type ModelConfigurationCommandFailure =
  (typeof MODEL_CONFIGURATION_COMMAND_FAILURE)[keyof typeof MODEL_CONFIGURATION_COMMAND_FAILURE];

export class ModelConfigurationCommandError extends Error {
  readonly failure: ModelConfigurationCommandFailure;
  readonly retryable: boolean;

  constructor(failure: ModelConfigurationCommandFailure, retryable = false) {
    super(`Model Configuration command failed: ${failure}`);
    this.name = "ModelConfigurationCommandError";
    this.failure = failure;
    this.retryable = retryable;
  }
}

export interface ModelConfigurationIdentityGenerator {
  generateConnectionId(): string;
  generateModelProfileId(): string;
  generateCredentialReference(): CredentialReference;
}

export class RandomModelConfigurationIdentityGenerator
  implements ModelConfigurationIdentityGenerator
{
  generateConnectionId(): string {
    return `connection:${generateCompactUuid()}`;
  }

  generateModelProfileId(): string {
    return `model-profile:${generateCompactUuid()}`;
  }

  generateCredentialReference(): CredentialReference {
    return new CredentialReference(`credential:model-connection:${generateCompactUuid()}`);
  }
}

export interface ModelConfigurationCommandService {
  upsert(
    request: UpsertModelConfigurationRequest,
  ): Promise<UpsertModelConfigurationResult>;

  setDefault(
    request: SetDefaultModelProfileRequest,
  ): Promise<SetDefaultModelProfileResult>;

  remove(
    request: RemoveModelConfigurationRequest,
  ): Promise<RemoveModelConfigurationResult>;
}

export interface StorageModelConfigurationCommandServiceOptions {
  readonly store: ApplicationConfigurationStore;
  readonly credentials: CredentialStore;
  readonly identities?: ModelConfigurationIdentityGenerator;
  readonly logger?: Logger;
}

export class StorageModelConfigurationCommandService
  implements ModelConfigurationCommandService
{
  readonly #store: ApplicationConfigurationStore;
  readonly #credentials: CredentialStore;
  readonly #identities: ModelConfigurationIdentityGenerator;
  readonly #logger: Logger;
  #mutationTail: Promise<void> = Promise.resolve();

  constructor(options: StorageModelConfigurationCommandServiceOptions) {
    this.#store = options.store;
    this.#credentials = options.credentials;
    this.#identities = options.identities ?? new RandomModelConfigurationIdentityGenerator();
    this.#logger = (options.logger ?? noopLogger).child({
      component: "storage_model_configuration_command_service",
    });
  }

  upsert(
    request: UpsertModelConfigurationRequest,
  ): Promise<UpsertModelConfigurationResult> {
    const captured = captureUpsertModelConfigurationRequest(request);
    return this.#mutate(() => this.#execute("upsert", () => this.#upsert(captured)));
  }

  setDefault(
    request: SetDefaultModelProfileRequest,
  ): Promise<SetDefaultModelProfileResult> {
    const captured = captureSetDefaultModelProfileRequest(request);
    return this.#mutate(() =>
      this.#execute("set_default", () => this.#setDefault(captured))
    );
  }

  remove(
    request: RemoveModelConfigurationRequest,
  ): Promise<RemoveModelConfigurationResult> {
    const captured = captureRemoveModelConfigurationRequest(request);
    return this.#mutate(() => this.#execute("remove", () => this.#remove(captured)));
  }

  async #upsert(
    request: UpsertModelConfigurationRequest,
  ): Promise<UpsertModelConfigurationResult> {
    this.#logger.debug("configuration.model.upsert_started", {
      credentialMutationKind: request.credential.kind,
      setAsDefault: request.setAsDefault,
    });
    const current = await this.#loadCurrent();
    this.#assertRevision(current, request.expectedRevision);
    const existingProfile = request.profile.id === undefined
      ? undefined
      : current.getModelProfile(request.profile.id);
    const connectionId = request.connection.id ??
      existingProfile?.connectionId ??
      this.#identities.generateConnectionId();
    if (
      existingProfile !== undefined &&
      request.connection.id !== undefined &&
      existingProfile.connectionId !== request.connection.id
    ) {
      throw new ModelConfigurationCommandError(
        MODEL_CONFIGURATION_COMMAND_FAILURE.modelConnectionMismatch,
      );
    }
    const profileId = request.profile.id ?? this.#identities.generateModelProfileId();
    const existingConnection = current.getModelConnection(connectionId);
    const previousCredential = existingConnection?.credentialRef;
    let stagedCredential: CredentialReference | undefined;
    if (request.credential.kind === MODEL_CREDENTIAL_MUTATION_KIND.replace) {
      stagedCredential = this.#identities.generateCredentialReference();
      await this.#credentials.save(stagedCredential, request.credential.secret);
    }

    const activeCredential = request.credential.kind ===
        MODEL_CREDENTIAL_MUTATION_KIND.replace
      ? stagedCredential
      : request.credential.kind === MODEL_CREDENTIAL_MUTATION_KIND.delete
      ? undefined
      : previousCredential;
    let credentialStatus: CredentialStatus;
    let next: ApplicationConfiguration;
    try {
      credentialStatus = await this.#readCredentialStatus(activeCredential);
      const nextConnection = new ModelConnection({
        ...request.connection,
        id: connectionId,
        ...(activeCredential === undefined
          ? {}
          : { credentialRef: activeCredential.id }),
        credentialConfigured: credentialStatus === "configured",
      });
      const nextProfile = new ModelProfile({
        ...request.profile,
        id: profileId,
        connectionId,
      });
      next = new ApplicationConfiguration({
        ...current.toSnapshot(),
        revision: current.revision + 1,
        modelConnections: replaceOrAppend(
          current.modelConnections.map((connection) => connection.toSnapshot()),
          nextConnection.toSnapshot(),
        ),
        modelProfiles: replaceOrAppend(
          current.modelProfiles.map((profile) => profile.toSnapshot()),
          nextProfile.toSnapshot(),
        ),
        ...(request.setAsDefault
          ? { defaultModelProfileId: profileId }
          : current.defaultModelProfileId === undefined
          ? { defaultModelProfileId: undefined }
          : { defaultModelProfileId: current.defaultModelProfileId }),
      });
      await this.#save(next, current.revision);
    } catch (error) {
      if (stagedCredential !== undefined) {
        await this.#discardStagedCredential(stagedCredential);
      }
      throw error;
    }

    const credentialCleanupStatus = await this.#cleanupSupersededCredential(
      previousCredential,
      activeCredential,
      next,
    );
    this.#logger.info("configuration.model.upsert_completed", {
      revision: next.revision,
      credentialStatus,
      credentialCleanupStatus,
    });
    return Object.freeze({
      schemaVersion: MODEL_CONFIGURATION_COMMAND_SCHEMA_VERSION,
      configuration: next.toSnapshot(),
      connectionId,
      modelProfileId: profileId,
      credentialStatus,
      credentialCleanupStatus,
    });
  }

  async #setDefault(
    request: SetDefaultModelProfileRequest,
  ): Promise<SetDefaultModelProfileResult> {
    this.#logger.debug("configuration.model.default_update_started");
    const current = await this.#loadCurrent();
    this.#assertRevision(current, request.expectedRevision);
    if (current.getModelProfile(request.modelProfileId) === undefined) {
      throw new ModelConfigurationCommandError(
        MODEL_CONFIGURATION_COMMAND_FAILURE.modelProfileMissing,
      );
    }
    const next = new ApplicationConfiguration({
      ...current.toSnapshot(),
      revision: current.revision + 1,
      defaultModelProfileId: request.modelProfileId,
    });
    await this.#save(next, current.revision);
    this.#logger.info("configuration.model.default_update_completed", {
      revision: next.revision,
    });
    return Object.freeze({
      schemaVersion: MODEL_CONFIGURATION_COMMAND_SCHEMA_VERSION,
      configuration: next.toSnapshot(),
    });
  }

  async #remove(
    request: RemoveModelConfigurationRequest,
  ): Promise<RemoveModelConfigurationResult> {
    this.#logger.debug("configuration.model.remove_started", {
      removeConnectionWhenUnused: request.removeConnectionWhenUnused,
    });
    const current = await this.#loadCurrent();
    this.#assertRevision(current, request.expectedRevision);
    const profile = current.getModelProfile(request.modelProfileId);
    if (profile === undefined) {
      throw new ModelConfigurationCommandError(
        MODEL_CONFIGURATION_COMMAND_FAILURE.modelProfileMissing,
      );
    }
    if (
      current.modelProfiles.some((candidate) =>
        candidate.id !== profile.id &&
        candidate.fallbackProfileIds.includes(profile.id)
      )
    ) {
      throw new ModelConfigurationCommandError(
        MODEL_CONFIGURATION_COMMAND_FAILURE.modelProfileReferenced,
      );
    }
    const remainingProfiles = current.modelProfiles.filter(
      (candidate) => candidate.id !== profile.id,
    );
    const removeConnection = request.removeConnectionWhenUnused &&
      !remainingProfiles.some((candidate) => candidate.connectionId === profile.connectionId);
    const removedConnection = removeConnection
      ? current.getModelConnection(profile.connectionId)
      : undefined;
    const next = new ApplicationConfiguration({
      ...current.toSnapshot(),
      revision: current.revision + 1,
      modelConnections: current.modelConnections
        .filter((connection) => !removeConnection || connection.id !== profile.connectionId)
        .map((connection) => connection.toSnapshot()),
      modelProfiles: remainingProfiles.map((candidate) => candidate.toSnapshot()),
      ...(current.defaultModelProfileId === profile.id
        ? { defaultModelProfileId: undefined }
        : current.defaultModelProfileId === undefined
        ? { defaultModelProfileId: undefined }
        : { defaultModelProfileId: current.defaultModelProfileId }),
    });
    await this.#save(next, current.revision);
    const credentialCleanupStatus = removedConnection?.credentialRef === undefined ||
        isCredentialReferenced(next, removedConnection.credentialRef)
      ? MODEL_CREDENTIAL_CLEANUP_STATUS.notRequired
      : await this.#deleteCommittedCredential(removedConnection.credentialRef);
    this.#logger.info("configuration.model.remove_completed", {
      revision: next.revision,
      connectionRemoved: removedConnection !== undefined,
      credentialCleanupStatus,
    });
    return Object.freeze({
      schemaVersion: MODEL_CONFIGURATION_COMMAND_SCHEMA_VERSION,
      configuration: next.toSnapshot(),
      removedModelProfileId: profile.id,
      ...(removedConnection === undefined
        ? {}
        : { removedConnectionId: removedConnection.id }),
      credentialCleanupStatus,
    });
  }

  async #loadCurrent(): Promise<ApplicationConfiguration> {
    const existing = await this.#store.load();
    if (existing !== undefined) return existing;
    const defaults = createDefaultApplicationConfiguration();
    try {
      await this.#store.save(defaults);
      return defaults;
    } catch (error) {
      const raced = await this.#store.load();
      if (raced !== undefined) return raced;
      throw error;
    }
  }

  #assertRevision(
    current: ApplicationConfiguration,
    expectedRevision: number,
  ): void {
    if (current.revision !== expectedRevision) {
      throw new ModelConfigurationCommandError(
        MODEL_CONFIGURATION_COMMAND_FAILURE.revisionConflict,
        true,
      );
    }
  }

  async #save(
    configuration: ApplicationConfiguration,
    expectedRevision: number,
  ): Promise<void> {
    try {
      await this.#store.save(configuration, expectedRevision);
    } catch (error) {
      if (isRevisionConflict(error)) {
        throw new ModelConfigurationCommandError(
          MODEL_CONFIGURATION_COMMAND_FAILURE.revisionConflict,
          true,
        );
      }
      throw error;
    }
  }

  async #discardStagedCredential(reference: CredentialReference): Promise<void> {
    try {
      await this.#credentials.delete(reference);
    } catch {
      this.#logger.info("configuration.model.credential_compensation_failed", {
        errorCode: MODEL_CONFIGURATION_COMMAND_FAILURE.credentialCompensationFailed,
      });
      throw new ModelConfigurationCommandError(
        MODEL_CONFIGURATION_COMMAND_FAILURE.credentialCompensationFailed,
        true,
      );
    }
  }

  async #cleanupSupersededCredential(
    previous: CredentialReference | undefined,
    active: CredentialReference | undefined,
    configuration: ApplicationConfiguration,
  ): Promise<ModelCredentialCleanupStatus> {
    if (
      previous === undefined ||
      previous.id === active?.id ||
      isCredentialReferenced(configuration, previous)
    ) {
      return MODEL_CREDENTIAL_CLEANUP_STATUS.notRequired;
    }
    return this.#deleteCommittedCredential(previous);
  }

  async #deleteCommittedCredential(
    reference: CredentialReference,
  ): Promise<ModelCredentialCleanupStatus> {
    try {
      await this.#credentials.delete(reference);
      return MODEL_CREDENTIAL_CLEANUP_STATUS.completed;
    } catch {
      this.#logger.info("configuration.model.credential_cleanup_deferred");
      return MODEL_CREDENTIAL_CLEANUP_STATUS.deferred;
    }
  }

  async #readCredentialStatus(
    reference: CredentialReference | undefined,
  ): Promise<CredentialStatus> {
    return reference === undefined
      ? "missing"
      : this.#credentials.getStatus(reference);
  }

  #mutate<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
    const result = this.#mutationTail.then(operation, operation);
    this.#mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  async #execute<TResult>(
    operationName: "upsert" | "set_default" | "remove",
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    try {
      return await operation();
    } catch (error) {
      this.#logger.error("configuration.model.command_failed", {
        operation: operationName,
        ...captureErrorIdentity(error),
      });
      throw error;
    }
  }
}

function replaceOrAppend<TValue extends { readonly id: string }>(
  values: readonly TValue[],
  value: TValue,
): readonly TValue[] {
  const index = values.findIndex((candidate) => candidate.id === value.id);
  if (index < 0) return Object.freeze([...values, value]);
  const next = [...values];
  next[index] = value;
  return Object.freeze(next);
}

function isRevisionConflict(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const record = error as { readonly failure?: unknown; readonly code?: unknown };
  return record.failure === MODEL_CONFIGURATION_COMMAND_FAILURE.revisionConflict ||
    record.code === MODEL_CONFIGURATION_COMMAND_FAILURE.revisionConflict;
}

function generateCompactUuid(): string {
  return globalThis.crypto.randomUUID().replaceAll("-", "");
}

function captureErrorIdentity(error: unknown): Readonly<{
  errorName: string;
  errorCode?: string;
}> {
  if (error === null || typeof error !== "object") {
    return Object.freeze({ errorName: "UnknownError" });
  }
  const record = error as {
    readonly name?: unknown;
    readonly failure?: unknown;
    readonly code?: unknown;
  };
  const errorCode = typeof record.failure === "string"
    ? record.failure
    : typeof record.code === "string"
    ? record.code
    : undefined;
  return Object.freeze({
    errorName: typeof record.name === "string" ? record.name : "UnknownError",
    ...(errorCode === undefined ? {} : { errorCode }),
  });
}

function isCredentialReferenced(
  configuration: ApplicationConfiguration,
  reference: CredentialReference,
): boolean {
  return configuration.modelConnections.some((connection) =>
    connection.credentialRef?.id === reference.id ||
    Object.values(connection.secretHeaderCredentialRefs).includes(reference.id)
  );
}
