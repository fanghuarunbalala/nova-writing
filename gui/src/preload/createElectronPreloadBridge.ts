/** Creates the only IPC capability object allowed to cross into the Renderer. */
import type {
  ApiRequest,
  ApiResponse,
  ApplicationConfigurationSnapshot,
  CredentialStatus,
  ModelConnectionProbeResult,
  RemoveModelConfigurationRequest,
  RemoveModelConfigurationResult,
  SetDefaultModelProfileRequest,
  SetDefaultModelProfileResult,
  UpsertModelConfigurationRequest,
  UpsertModelConfigurationResult,
} from "@novel/core";
import {
  ELECTRON_API_IPC_CHANNEL,
  ELECTRON_APPLICATION_COMMAND_CHANNEL,
  ELECTRON_CONFIGURATION_IPC_CHANNEL,
  ELECTRON_WORKSPACE_IPC_CHANNEL,
  type ElectronApplicationCommand,
  type ElectronApplicationCommandBridge,
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
  on?(
    channel: string,
    listener: (event: unknown, value: unknown) => void,
  ): void;
  removeListener?(
    channel: string,
    listener: (event: unknown, value: unknown) => void,
  ): void;
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
    ...createCommandBridge(options.ipcRenderer),
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
    configuration: Object.freeze({
      load: () =>
        invoke<ApplicationConfigurationSnapshot>(
          ELECTRON_CONFIGURATION_IPC_CHANNEL.load,
        ),
      save: (configuration: ApplicationConfigurationSnapshot) =>
        invoke<ApplicationConfigurationSnapshot>(
          ELECTRON_CONFIGURATION_IPC_CHANNEL.save,
          configuration,
        ),
      upsertModelConfiguration: (request: UpsertModelConfigurationRequest) =>
        invoke<UpsertModelConfigurationResult>(
          ELECTRON_CONFIGURATION_IPC_CHANNEL.modelUpsert,
          request,
        ),
      setDefaultModelProfile: (request: SetDefaultModelProfileRequest) =>
        invoke<SetDefaultModelProfileResult>(
          ELECTRON_CONFIGURATION_IPC_CHANNEL.modelDefaultSet,
          request,
        ),
      removeModelConfiguration: (request: RemoveModelConfigurationRequest) =>
        invoke<RemoveModelConfigurationResult>(
          ELECTRON_CONFIGURATION_IPC_CHANNEL.modelRemove,
          request,
        ),
      probeModelConnection: () =>
        invoke<ModelConnectionProbeResult>(
          ELECTRON_CONFIGURATION_IPC_CHANNEL.modelProbe,
        ),
      getCredentialStatus: (credentialRef: string) =>
        invoke<CredentialStatus>(
          ELECTRON_CONFIGURATION_IPC_CHANNEL.credentialStatus,
          credentialRef,
        ),
      saveCredential: (credentialRef: string, secret: string) =>
        invoke<ElectronBridgeAcknowledgement>(
          ELECTRON_CONFIGURATION_IPC_CHANNEL.credentialSave,
          credentialRef,
          secret,
        ),
      deleteCredential: (credentialRef: string) =>
        invoke<ElectronBridgeAcknowledgement>(
          ELECTRON_CONFIGURATION_IPC_CHANNEL.credentialDelete,
          credentialRef,
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

function createCommandBridge(
  ipcRenderer: ElectronIpcRendererPort,
): { readonly commands: ElectronApplicationCommandBridge } | Record<string, never> {
  if (
    typeof ipcRenderer.on !== "function" ||
    typeof ipcRenderer.removeListener !== "function"
  ) {
    return Object.freeze({});
  }
  const commands: ElectronApplicationCommandBridge = Object.freeze({
    subscribe: (listener: (command: ElectronApplicationCommand) => void) => {
      const receive = (_event: unknown, value: unknown): void => {
        const command = captureApplicationCommand(value);
        if (command !== undefined) listener(command);
      };
      ipcRenderer.on?.(ELECTRON_APPLICATION_COMMAND_CHANNEL, receive);
      return () => {
        ipcRenderer.removeListener?.(ELECTRON_APPLICATION_COMMAND_CHANNEL, receive);
      };
    },
  });
  return Object.freeze({ commands });
}

function captureApplicationCommand(
  value: unknown,
): ElectronApplicationCommand | undefined {
  if (
    value === "workspace.open" ||
    value === "workspace.close" ||
    value === "settings.open"
  ) {
    return value;
  }
  return undefined;
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
