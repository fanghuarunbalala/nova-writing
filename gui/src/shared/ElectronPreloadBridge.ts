/** JSON-safe capability surface exposed by Electron Preload to the Renderer. */
import type {
  ApiEventFrame,
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
import type { FrontendFileReference } from "@novel/ui";
import type {
  DesktopFileSelectionOptions,
  DesktopTrayMenuItem,
  DesktopTrayNotification,
  DesktopUpdateInfo,
} from "./ElectronDesktopPorts.js";

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
  /** 订阅主进程 workspace 已打开推送（renderer 错过 open 响应时同步状态）。Subscribes to workspace-opened push events. */
  onWorkspaceOpened(
    listener: (session: ElectronWorkspaceSession) => void,
  ): () => void;
}

export interface ElectronConfigurationBridge {
  load(): Promise<ElectronBridgeResult<ApplicationConfigurationSnapshot>>;
  save(
    configuration: ApplicationConfigurationSnapshot,
  ): Promise<ElectronBridgeResult<ApplicationConfigurationSnapshot>>;
  upsertModelConfiguration(
    request: UpsertModelConfigurationRequest,
  ): Promise<ElectronBridgeResult<UpsertModelConfigurationResult>>;
  setDefaultModelProfile(
    request: SetDefaultModelProfileRequest,
  ): Promise<ElectronBridgeResult<SetDefaultModelProfileResult>>;
  removeModelConfiguration(
    request: RemoveModelConfigurationRequest,
  ): Promise<ElectronBridgeResult<RemoveModelConfigurationResult>>;
  probeModelConnection(): Promise<ElectronBridgeResult<ModelConnectionProbeResult>>;
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

/**
 * 窗口操作 bridge（spec 5.4 DesktopWindowPort）。
 * 每个方法对应一个 IPC channel，返回 ElectronBridgeResult<Acknowledgement>。
 */
export interface ElectronWindowBridge {
  minimize(): Promise<ElectronBridgeResult<ElectronBridgeAcknowledgement>>;
  maximize(): Promise<ElectronBridgeResult<ElectronBridgeAcknowledgement>>;
  close(): Promise<ElectronBridgeResult<ElectronBridgeAcknowledgement>>;
  setAlwaysOnTop(
    alwaysOnTop: boolean,
  ): Promise<ElectronBridgeResult<ElectronBridgeAcknowledgement>>;
  setFullscreen(
    fullscreen: boolean,
  ): Promise<ElectronBridgeResult<ElectronBridgeAcknowledgement>>;
}

/**
 * 自动更新 bridge（spec 5.4 DesktopUpdaterPort）。
 * checkForUpdates 返回 UpdateInfo | undefined（无更新时 undefined）。
 */
export interface ElectronUpdaterBridge {
  checkForUpdates(): Promise<ElectronBridgeResult<DesktopUpdateInfo | undefined>>;
  downloadUpdate(): Promise<ElectronBridgeResult<ElectronBridgeAcknowledgement>>;
  quitAndInstall(): Promise<ElectronBridgeResult<ElectronBridgeAcknowledgement>>;
}

/**
 * 系统托盘 bridge（spec 5.4 DesktopSystemTrayPort）。
 * setTrayMenu 的 items 经 JSON 序列化传到 Main，点击事件暂不回传（Phase B.3 仅端口）。
 */
export interface ElectronSystemTrayBridge {
  setTrayIcon(
    iconPath: string,
  ): Promise<ElectronBridgeResult<ElectronBridgeAcknowledgement>>;
  setTrayMenu(
    items: readonly DesktopTrayMenuItem[],
  ): Promise<ElectronBridgeResult<ElectronBridgeAcknowledgement>>;
  showTrayNotification(
    notification: DesktopTrayNotification,
  ): Promise<ElectronBridgeResult<ElectronBridgeAcknowledgement>>;
}

/**
 * 原生文件选择 bridge（spec 5.4 DesktopNativeFilePort）。
 * selectFile/selectDirectory 返回 FrontendFileReference[]（shared 类型），
 * referenceId 对 renderer 不透明；previewFile 触发系统预览。
 */
export interface ElectronNativeFileBridge {
  selectFile(
    options?: DesktopFileSelectionOptions,
  ): Promise<ElectronBridgeResult<readonly FrontendFileReference[]>>;
  selectDirectory(
    options?: DesktopFileSelectionOptions,
  ): Promise<ElectronBridgeResult<readonly FrontendFileReference[]>>;
  previewFile(
    referenceId: string,
  ): Promise<ElectronBridgeResult<ElectronBridgeAcknowledgement>>;
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
  readonly window?: ElectronWindowBridge;
  readonly updater?: ElectronUpdaterBridge;
  readonly tray?: ElectronSystemTrayBridge;
  readonly files?: ElectronNativeFileBridge;

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
