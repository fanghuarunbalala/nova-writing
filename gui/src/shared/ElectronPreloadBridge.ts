/** JSON-safe capability surface exposed by Electron Preload to the Renderer. */
import type {
  ApiEventFrame,
  ApiRequest,
  ApiResponse,
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

export interface ElectronBridgeOpenSubscriptionRequest {
  readonly subscriptionId: string;
  readonly request: ApiRequest;
}

export type ElectronBridgeSubscriptionRead =
  | { readonly done: true }
  | { readonly done: false; readonly frame: ApiEventFrame };

export interface ElectronPreloadBridge {
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
