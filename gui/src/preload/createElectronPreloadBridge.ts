/** Creates the only IPC capability object allowed to cross into the Renderer. */
import type { ApiRequest, ApiResponse } from "@novel/core";
import {
  ELECTRON_API_IPC_CHANNEL,
  ELECTRON_WORKSPACE_IPC_CHANNEL,
  type ElectronBridgeAcknowledgement,
  type ElectronBridgeOpenSubscriptionRequest,
  type ElectronBridgeResult,
  type ElectronBridgeSubscriptionRead,
  type ElectronPreloadBridge,
  type ElectronWorkspaceReference,
  type ElectronWorkspaceSession,
} from "../shared/index.js";

export interface ElectronIpcRendererPort {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

export interface CreateElectronPreloadBridgeOptions {
  readonly ipcRenderer: ElectronIpcRendererPort;
}

export function createElectronPreloadBridge(
  options: CreateElectronPreloadBridgeOptions,
): ElectronPreloadBridge {
  const invoke = <TValue>(
    channel: string,
    ...args: unknown[]
  ): Promise<ElectronBridgeResult<TValue>> =>
    invokeSafely<TValue>(options.ipcRenderer, channel, args);

  const bridge: ElectronPreloadBridge = {
    workspaces: Object.freeze({
      select: () =>
        invoke<ElectronWorkspaceReference | undefined>(
          ELECTRON_WORKSPACE_IPC_CHANNEL.select,
        ),
      listRecent: () =>
        invoke<readonly ElectronWorkspaceSession[]>(
          ELECTRON_WORKSPACE_IPC_CHANNEL.listRecent,
        ),
      open: (reference: ElectronWorkspaceReference) =>
        invoke<ElectronWorkspaceSession>(
          ELECTRON_WORKSPACE_IPC_CHANNEL.open,
          reference,
        ),
      close: () =>
        invoke<ElectronBridgeAcknowledgement>(
          ELECTRON_WORKSPACE_IPC_CHANNEL.close,
        ),
    }),
    request: (request: ApiRequest) =>
      invoke<ApiResponse>(ELECTRON_API_IPC_CHANNEL.request, request),
    cancelRequest: (requestId: string) =>
      invoke<ElectronBridgeAcknowledgement>(
        ELECTRON_API_IPC_CHANNEL.cancelRequest,
        requestId,
      ),
    openSubscription: (request: ElectronBridgeOpenSubscriptionRequest) =>
      invoke<ElectronBridgeAcknowledgement>(
        ELECTRON_API_IPC_CHANNEL.openSubscription,
        request,
      ),
    readSubscription: (subscriptionId: string) =>
      invoke<ElectronBridgeSubscriptionRead>(
        ELECTRON_API_IPC_CHANNEL.readSubscription,
        subscriptionId,
      ),
    closeSubscription: (subscriptionId: string) =>
      invoke<ElectronBridgeAcknowledgement>(
        ELECTRON_API_IPC_CHANNEL.closeSubscription,
        subscriptionId,
      ),
  };
  return Object.freeze(bridge);
}

async function invokeSafely<TValue>(
  ipcRenderer: ElectronIpcRendererPort,
  channel: string,
  args: readonly unknown[],
): Promise<ElectronBridgeResult<TValue>> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as ElectronBridgeResult<TValue>;
  } catch {
    return {
      ok: false,
      error: {
        code: "API_TRANSPORT_DISCONNECTED",
        retryable: true,
      },
    };
  }
}
