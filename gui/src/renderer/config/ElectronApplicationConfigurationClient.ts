/** Adapts the Electron Configuration Bridge to the shared UI Config client. */
import type {
  ApplicationConfigurationSnapshot,
  RemoveModelConfigurationRequest,
  RemoveModelConfigurationResult,
  SetDefaultModelProfileRequest,
  SetDefaultModelProfileResult,
  ModelConnectionProbeResult,
  UpsertModelConfigurationRequest,
  UpsertModelConfigurationResult,
} from "@novel/core";
import type { ApplicationConfigurationClient } from "@novel/ui";
import type {
  ElectronBridgeResult,
  ElectronConfigurationBridge,
} from "../../shared/index.js";

export class ElectronApplicationConfigurationClient
  implements ApplicationConfigurationClient
{
  constructor(private readonly bridge: ElectronConfigurationBridge) {}

  load(): Promise<ApplicationConfigurationSnapshot> {
    return unwrapPromise(this.bridge.load());
  }

  save(
    configuration: ApplicationConfigurationSnapshot,
  ): Promise<ApplicationConfigurationSnapshot> {
    return unwrapPromise(this.bridge.save(configuration));
  }

  upsertModelConfiguration(
    request: UpsertModelConfigurationRequest,
  ): Promise<UpsertModelConfigurationResult> {
    return unwrapPromise(this.bridge.upsertModelConfiguration(request));
  }

  setDefaultModelProfile(
    request: SetDefaultModelProfileRequest,
  ): Promise<SetDefaultModelProfileResult> {
    return unwrapPromise(this.bridge.setDefaultModelProfile(request));
  }

  removeModelConfiguration(
    request: RemoveModelConfigurationRequest,
  ): Promise<RemoveModelConfigurationResult> {
    return unwrapPromise(this.bridge.removeModelConfiguration(request));
  }

  probeModelConnection(): Promise<ModelConnectionProbeResult> {
    return unwrapPromise(this.bridge.probeModelConnection());
  }

  getCredentialStatus(credentialRef: string) {
    return unwrapPromise(this.bridge.getCredentialStatus(credentialRef));
  }

  saveCredential(credentialRef: string, secret: string): Promise<void> {
    return unwrapPromise(this.bridge.saveCredential(credentialRef, secret)).then(
      () => undefined,
    );
  }

  deleteCredential(credentialRef: string): Promise<void> {
    return unwrapPromise(this.bridge.deleteCredential(credentialRef)).then(
      () => undefined,
    );
  }
}

export class ElectronApplicationConfigurationClientError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, retryable: boolean) {
    super("Electron Application Configuration operation failed");
    this.name = "ElectronApplicationConfigurationClientError";
    this.code = code;
    this.retryable = retryable;
  }
}

async function unwrapPromise<TValue>(
  result: Promise<ElectronBridgeResult<TValue>>,
): Promise<TValue> {
  const settled = await result;
  if (!settled.ok) {
    throw new ElectronApplicationConfigurationClientError(
      settled.error.code,
      settled.error.retryable,
    );
  }
  return settled.value;
}
