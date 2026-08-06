/** Validates and narrows the only global capability accepted by the Renderer. */
import {
  ApiTransportError,
  type ApiRequest,
  type ApplicationConfigurationSnapshot,
  type RemoveModelConfigurationRequest,
  type SetDefaultModelProfileRequest,
  type UpsertModelConfigurationRequest,
} from "@novel/core";
import type {
  DesktopFileSelectionOptions,
  DesktopTrayMenuItem,
  DesktopTrayNotification,
  ElectronApplicationCommand,
  ElectronApplicationCommandBridge,
  ElectronBridgeOpenSubscriptionRequest,
  ElectronConfigurationBridge,
  ElectronNativeFileBridge,
  ElectronPreloadBridge,
  ElectronSystemTrayBridge,
  ElectronUpdaterBridge,
  ElectronWindowBridge,
  ElectronWorkspaceBridge,
  ElectronWorkspaceReference,
  ElectronWorkspaceSession,
} from "../shared/index.js";

declare global {
  interface Window {
    readonly novelDesktop?: unknown;
  }
}

const BRIDGE_METHODS = Object.freeze([
  "cancelRequest",
  "closeSubscription",
  "openSubscription",
  "readSubscription",
  "request",
] as const);

export interface DesktopRendererWindowPort {
  readonly novelDesktop?: unknown;
}

export function resolveElectronPreloadBridge(
  windowPort: DesktopRendererWindowPort,
): ElectronPreloadBridge {
  const candidate = windowPort.novelDesktop;
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw bridgeUnavailable();
  }
  const record = candidate as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const acceptedKeys = [
    ...BRIDGE_METHODS,
    ...(record.commands === undefined ? [] : ["commands"]),
    ...(record.configuration === undefined ? [] : ["configuration"]),
    ...(record.workspaces === undefined ? [] : ["workspaces"]),
    ...(record.window === undefined ? [] : ["window"]),
    ...(record.updater === undefined ? [] : ["updater"]),
    ...(record.tray === undefined ? [] : ["tray"]),
    ...(record.files === undefined ? [] : ["files"]),
  ].sort();
  if (
    keys.length !== acceptedKeys.length ||
    acceptedKeys.some((method, index) => keys[index] !== method)
  ) {
    throw bridgeUnavailable();
  }
  for (const method of BRIDGE_METHODS) {
    if (typeof record[method] !== "function") throw bridgeUnavailable();
  }
  const commands = resolveCommandBridge(record.commands);
  const configuration = resolveConfigurationBridge(record.configuration);
  const workspaces = resolveWorkspaceBridge(record.workspaces);
  const window = resolveWindowBridge(record.window);
  const updater = resolveUpdaterBridge(record.updater);
  const tray = resolveSystemTrayBridge(record.tray);
  const files = resolveNativeFileBridge(record.files);
  const bridge = candidate as ElectronPreloadBridge;
  const resolved: ElectronPreloadBridge = {
    ...(commands !== undefined ? { commands } : {}),
    ...(configuration !== undefined ? { configuration } : {}),
    ...(workspaces !== undefined ? { workspaces } : {}),
    ...(window !== undefined ? { window } : {}),
    ...(updater !== undefined ? { updater } : {}),
    ...(tray !== undefined ? { tray } : {}),
    ...(files !== undefined ? { files } : {}),
    request: (request: ApiRequest) => bridge.request(request),
    cancelRequest: (requestId: string) => bridge.cancelRequest(requestId),
    openSubscription: (request: ElectronBridgeOpenSubscriptionRequest) =>
      bridge.openSubscription(request),
    readSubscription: (subscriptionId: string) =>
      bridge.readSubscription(subscriptionId),
    closeSubscription: (subscriptionId: string) =>
      bridge.closeSubscription(subscriptionId),
  };
  return Object.freeze(resolved);
}

function resolveConfigurationBridge(
  value: unknown,
): ElectronConfigurationBridge | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw bridgeUnavailable();
  }
  const record = value as Record<string, unknown>;
  const methods = [
    "deleteCredential",
    "getCredentialStatus",
    "load",
    "probeModelConnection",
    "removeModelConfiguration",
    "save",
    "saveCredential",
    "setDefaultModelProfile",
    "upsertModelConfiguration",
  ] as const;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== methods.length ||
    methods.some((method, index) => keys[index] !== method) ||
    methods.some((method) => typeof record[method] !== "function")
  ) {
    throw bridgeUnavailable();
  }
  const bridge = value as ElectronConfigurationBridge;
  return Object.freeze({
    load: () => bridge.load(),
    save: (configuration: ApplicationConfigurationSnapshot) =>
      bridge.save(configuration),
    upsertModelConfiguration: (request: UpsertModelConfigurationRequest) =>
      bridge.upsertModelConfiguration(request),
    setDefaultModelProfile: (request: SetDefaultModelProfileRequest) =>
      bridge.setDefaultModelProfile(request),
    removeModelConfiguration: (request: RemoveModelConfigurationRequest) =>
      bridge.removeModelConfiguration(request),
    probeModelConnection: () => bridge.probeModelConnection(),
    getCredentialStatus: (credentialRef: string) =>
      bridge.getCredentialStatus(credentialRef),
    saveCredential: (credentialRef: string, secret: string) =>
      bridge.saveCredential(credentialRef, secret),
    deleteCredential: (credentialRef: string) =>
      bridge.deleteCredential(credentialRef),
  });
}

function resolveCommandBridge(
  value: unknown,
): ElectronApplicationCommandBridge | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw bridgeUnavailable();
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).join(",") !== "subscribe" ||
    typeof record.subscribe !== "function"
  ) {
    throw bridgeUnavailable();
  }
  const bridge = value as ElectronApplicationCommandBridge;
  return Object.freeze({
    subscribe: (listener: (command: ElectronApplicationCommand) => void) =>
      bridge.subscribe(listener),
  });
}

function resolveWorkspaceBridge(value: unknown): ElectronWorkspaceBridge | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw bridgeUnavailable();
  }
  const record = value as Record<string, unknown>;
  const methods = [
    "close",
    "listRecent",
    "onWorkspaceOpened",
    "open",
    "select",
  ] as const;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== methods.length ||
    methods.some((method, index) => keys[index] !== method) ||
    methods.some((method) => typeof record[method] !== "function")
  ) {
    throw bridgeUnavailable();
  }
  const bridge = value as ElectronWorkspaceBridge;
  return Object.freeze({
    select: () => bridge.select(),
    listRecent: () => bridge.listRecent(),
    open: (reference: ElectronWorkspaceReference) => bridge.open(reference),
    close: () => bridge.close(),
    onWorkspaceOpened: (
      listener: (session: ElectronWorkspaceSession) => void,
    ) => bridge.onWorkspaceOpened(listener),
  });
}

function resolveWindowBridge(value: unknown): ElectronWindowBridge | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw bridgeUnavailable();
  }
  const record = value as Record<string, unknown>;
  const methods = [
    "close",
    "maximize",
    "minimize",
    "setAlwaysOnTop",
    "setFullscreen",
  ] as const;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== methods.length ||
    methods.some((method, index) => keys[index] !== method) ||
    methods.some((method) => typeof record[method] !== "function")
  ) {
    throw bridgeUnavailable();
  }
  const bridge = value as ElectronWindowBridge;
  return Object.freeze({
    minimize: () => bridge.minimize(),
    maximize: () => bridge.maximize(),
    close: () => bridge.close(),
    setAlwaysOnTop: (alwaysOnTop: boolean) => bridge.setAlwaysOnTop(alwaysOnTop),
    setFullscreen: (fullscreen: boolean) => bridge.setFullscreen(fullscreen),
  });
}

function resolveUpdaterBridge(value: unknown): ElectronUpdaterBridge | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw bridgeUnavailable();
  }
  const record = value as Record<string, unknown>;
  const methods = ["checkForUpdates", "downloadUpdate", "quitAndInstall"] as const;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== methods.length ||
    methods.some((method, index) => keys[index] !== method) ||
    methods.some((method) => typeof record[method] !== "function")
  ) {
    throw bridgeUnavailable();
  }
  const bridge = value as ElectronUpdaterBridge;
  return Object.freeze({
    checkForUpdates: () => bridge.checkForUpdates(),
    downloadUpdate: () => bridge.downloadUpdate(),
    quitAndInstall: () => bridge.quitAndInstall(),
  });
}

function resolveSystemTrayBridge(value: unknown): ElectronSystemTrayBridge | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw bridgeUnavailable();
  }
  const record = value as Record<string, unknown>;
  const methods = ["setTrayIcon", "setTrayMenu", "showTrayNotification"] as const;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== methods.length ||
    methods.some((method, index) => keys[index] !== method) ||
    methods.some((method) => typeof record[method] !== "function")
  ) {
    throw bridgeUnavailable();
  }
  const bridge = value as ElectronSystemTrayBridge;
  return Object.freeze({
    setTrayIcon: (iconPath: string) => bridge.setTrayIcon(iconPath),
    setTrayMenu: (items: readonly DesktopTrayMenuItem[]) => bridge.setTrayMenu(items),
    showTrayNotification: (notification: DesktopTrayNotification) =>
      bridge.showTrayNotification(notification),
  });
}

function resolveNativeFileBridge(value: unknown): ElectronNativeFileBridge | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw bridgeUnavailable();
  }
  const record = value as Record<string, unknown>;
  const methods = ["previewFile", "selectDirectory", "selectFile"] as const;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== methods.length ||
    methods.some((method, index) => keys[index] !== method) ||
    methods.some((method) => typeof record[method] !== "function")
  ) {
    throw bridgeUnavailable();
  }
  const bridge = value as ElectronNativeFileBridge;
  return Object.freeze({
    selectFile: (options?: DesktopFileSelectionOptions) => bridge.selectFile(options),
    selectDirectory: (options?: DesktopFileSelectionOptions) =>
      bridge.selectDirectory(options),
    previewFile: (referenceId: string) => bridge.previewFile(referenceId),
  });
}

function bridgeUnavailable(): ApiTransportError {
  return new ApiTransportError(
    "ELECTRON_PRELOAD_BRIDGE_UNAVAILABLE",
    false,
    "Electron Preload bridge is unavailable",
  );
}
