/** JSON-safe capability surface exposed by Electron Preload to the Renderer. */
import type {
  ApiEventFrame,
  ApiRequest,
  ApiResponse,
  ApplicationConfigurationSnapshot,
  CredentialStatus,
} from "@novel/core";

export interface ElectronBridgeFailure {
  readonly code: string;
  readonly retryable: boolean;
}

export type ElectronBridgeResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: ElectronBridgeFailure };

export interface ElectronBridgeAcknowledgement {
  readonly acknowledged: true;
}

export interface ElectronWorkspaceReference {
  readonly referenceId: string;
  readonly label: string;
}

export interface ElectronWorkspaceSession {
  readonly id: string;
  readonly label: string;
}

export interface ElectronWorkspaceBridge {
  select(): Promise<ElectronBridgeResult<ElectronWorkspaceReference | undefined>>;
  listRecent(): Promise<ElectronBridgeResult<readonly ElectronWorkspaceSession[]>>;
  open(
    reference: ElectronWorkspaceReference,
  ): Promise<ElectronBridgeResult<ElectronWorkspaceSession>>;
  close(): Promise<ElectronBridgeResult<ElectronBridgeAcknowledgement>>;
}

export interface ElectronConfigurationBridge {
  load(): Promise<ElectronBridgeResult<ApplicationConfigurationSnapshot>>;
  save(
    configuration: ApplicationConfigurationSnapshot,
  ): Promise<ElectronBridgeResult<ApplicationConfigurationSnapshot>>;
  getCredentialStatus(
    credentialRef: string,
  ): Promise<ElectronBridgeResult<CredentialStatus>>;
  saveCredential(
    credentialRef: string,
    secret: string,
  ): Promise<ElectronBridgeResult<ElectronBridgeAcknowledgement>>;
  deleteCredential(
    credentialRef: string,
  ): Promise<ElectronBridgeResult<ElectronBridgeAcknowledgement>>;
}

export type ElectronApplicationCommand =
  | "workspace.open"
  | "workspace.close"
  | "settings.open";

export interface ElectronApplicationCommandBridge {
  subscribe(
    listener: (command: ElectronApplicationCommand) => void,
  ): () => void;
}

export interface ElectronBridgeOpenSubscriptionRequest {
  readonly subscriptionId: string;
  readonly request: ApiRequest;
}

export type ElectronBridgeSubscriptionRead =
  | { readonly done: true }
  | { readonly done: false; readonly frame: ApiEventFrame };

export interface ElectronPreloadBridge {
  readonly commands?: ElectronApplicationCommandBridge;
  readonly workspaces?: ElectronWorkspaceBridge;
  readonly configuration?: ElectronConfigurationBridge;

  request(
    request: ApiRequest,
  ): Promise<ElectronBridgeResult<ApiResponse>>;

  cancelRequest(
    requestId: string,
  ): Promise<ElectronBridgeResult<ElectronBridgeAcknowledgement>>;

  openSubscription(
    request: ElectronBridgeOpenSubscriptionRequest,
  ): Promise<ElectronBridgeResult<ElectronBridgeAcknowledgement>>;

  readSubscription(
    subscriptionId: string,
  ): Promise<ElectronBridgeResult<ElectronBridgeSubscriptionRead>>;

  closeSubscription(
    subscriptionId: string,
  ): Promise<ElectronBridgeResult<ElectronBridgeAcknowledgement>>;
}
