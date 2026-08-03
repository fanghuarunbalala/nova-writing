/** Fixed, versioned Electron IPC names shared by Main and Preload adapters. */
export const NOVEL_DESKTOP_BRIDGE_KEY = "novelDesktop" as const;

export const ELECTRON_API_IPC_CHANNEL = Object.freeze({
  request: "novel.api.v1.request",
  cancelRequest: "novel.api.v1.request.cancel",
  openSubscription: "novel.api.v1.subscription.open",
  readSubscription: "novel.api.v1.subscription.read",
  closeSubscription: "novel.api.v1.subscription.close",
} as const);

export type ElectronApiIpcChannel =
  (typeof ELECTRON_API_IPC_CHANNEL)[keyof typeof ELECTRON_API_IPC_CHANNEL];

export const ELECTRON_API_IPC_CHANNELS: readonly ElectronApiIpcChannel[] =
  Object.freeze(Object.values(ELECTRON_API_IPC_CHANNEL));

export const ELECTRON_WORKSPACE_IPC_CHANNEL = Object.freeze({
  select: "novel.workspace.v1.select",
  listRecent: "novel.workspace.v1.list-recent",
  open: "novel.workspace.v1.open",
  close: "novel.workspace.v1.close",
} as const);

export type ElectronWorkspaceIpcChannel =
  (typeof ELECTRON_WORKSPACE_IPC_CHANNEL)[keyof typeof ELECTRON_WORKSPACE_IPC_CHANNEL];

export const ELECTRON_WORKSPACE_IPC_CHANNELS: readonly ElectronWorkspaceIpcChannel[] =
  Object.freeze(Object.values(ELECTRON_WORKSPACE_IPC_CHANNEL));

export const ELECTRON_APPLICATION_COMMAND_CHANNEL =
  "novel.application.v1.command" as const;

export const ELECTRON_CONFIGURATION_IPC_CHANNEL = Object.freeze({
  load: "novel.configuration.v1.load",
  save: "novel.configuration.v1.save",
  modelUpsert: "novel.configuration.v1.model.upsert",
  modelDefaultSet: "novel.configuration.v1.model.default.set",
  modelRemove: "novel.configuration.v1.model.remove",
  credentialStatus: "novel.configuration.v1.credential.status",
  credentialSave: "novel.configuration.v1.credential.save",
  credentialDelete: "novel.configuration.v1.credential.delete",
} as const);

export type ElectronConfigurationIpcChannel =
  (typeof ELECTRON_CONFIGURATION_IPC_CHANNEL)[keyof typeof ELECTRON_CONFIGURATION_IPC_CHANNEL];

export const ELECTRON_CONFIGURATION_IPC_CHANNELS: readonly ElectronConfigurationIpcChannel[] =
  Object.freeze(Object.values(ELECTRON_CONFIGURATION_IPC_CHANNEL));
