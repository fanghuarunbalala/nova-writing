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
  opened: "novel.workspace.v1.opened",
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
  modelProbe: "novel.configuration.v1.model.probe",
  credentialStatus: "novel.configuration.v1.credential.status",
  credentialSave: "novel.configuration.v1.credential.save",
  credentialDelete: "novel.configuration.v1.credential.delete",
} as const);

export type ElectronConfigurationIpcChannel =
  (typeof ELECTRON_CONFIGURATION_IPC_CHANNEL)[keyof typeof ELECTRON_CONFIGURATION_IPC_CHANNEL];

export const ELECTRON_CONFIGURATION_IPC_CHANNELS: readonly ElectronConfigurationIpcChannel[] =
  Object.freeze(Object.values(ELECTRON_CONFIGURATION_IPC_CHANNEL));

/**
 * 桌面窗口操作 IPC 通道（spec 5.4 DesktopWindowPort）。
 * Renderer -> Preload -> Main：minimize / maximize / close / setAlwaysOnTop / setFullscreen。
 */
export const ELECTRON_WINDOW_IPC_CHANNEL = Object.freeze({
  minimize: "novel.window.v1.minimize",
  maximize: "novel.window.v1.maximize",
  close: "novel.window.v1.close",
  alwaysOnTopSet: "novel.window.v1.always-on-top.set",
  fullscreenSet: "novel.window.v1.fullscreen.set",
} as const);

export type ElectronWindowIpcChannel =
  (typeof ELECTRON_WINDOW_IPC_CHANNEL)[keyof typeof ELECTRON_WINDOW_IPC_CHANNEL];

export const ELECTRON_WINDOW_IPC_CHANNELS: readonly ElectronWindowIpcChannel[] =
  Object.freeze(Object.values(ELECTRON_WINDOW_IPC_CHANNEL));

/**
 * 应用自动更新 IPC 通道（spec 5.4 DesktopUpdaterPort）。
 * 包装 Electron autoUpdater：checkForUpdates / downloadUpdate / quitAndInstall。
 */
export const ELECTRON_UPDATER_IPC_CHANNEL = Object.freeze({
  check: "novel.updater.v1.check",
  download: "novel.updater.v1.download",
  quitAndInstall: "novel.updater.v1.quit-and-install",
} as const);

export type ElectronUpdaterIpcChannel =
  (typeof ELECTRON_UPDATER_IPC_CHANNEL)[keyof typeof ELECTRON_UPDATER_IPC_CHANNEL];

export const ELECTRON_UPDATER_IPC_CHANNELS: readonly ElectronUpdaterIpcChannel[] =
  Object.freeze(Object.values(ELECTRON_UPDATER_IPC_CHANNEL));

/**
 * 系统托盘 IPC 通道（spec 5.4 DesktopSystemTrayPort）。
 * 包装 Electron Tray + Notification：setTrayIcon / setTrayMenu / showTrayNotification。
 */
export const ELECTRON_SYSTEM_TRAY_IPC_CHANNEL = Object.freeze({
  iconSet: "novel.tray.v1.icon.set",
  menuSet: "novel.tray.v1.menu.set",
  notificationShow: "novel.tray.v1.notification.show",
} as const);

export type ElectronSystemTrayIpcChannel =
  (typeof ELECTRON_SYSTEM_TRAY_IPC_CHANNEL)[keyof typeof ELECTRON_SYSTEM_TRAY_IPC_CHANNEL];

export const ELECTRON_SYSTEM_TRAY_IPC_CHANNELS: readonly ElectronSystemTrayIpcChannel[] =
  Object.freeze(Object.values(ELECTRON_SYSTEM_TRAY_IPC_CHANNEL));

/**
 * 原生文件选择 IPC 通道（spec 5.4 DesktopNativeFilePort）。
 * 包装 Electron dialog + shell：selectFile / selectDirectory / previewFile。
 */
export const ELECTRON_NATIVE_FILE_IPC_CHANNEL = Object.freeze({
  selectFile: "novel.file.v1.select-file",
  selectDirectory: "novel.file.v1.select-directory",
  preview: "novel.file.v1.preview",
} as const);

export type ElectronNativeFileIpcChannel =
  (typeof ELECTRON_NATIVE_FILE_IPC_CHANNEL)[keyof typeof ELECTRON_NATIVE_FILE_IPC_CHANNEL];

export const ELECTRON_NATIVE_FILE_IPC_CHANNELS: readonly ElectronNativeFileIpcChannel[] =
  Object.freeze(Object.values(ELECTRON_NATIVE_FILE_IPC_CHANNEL));
