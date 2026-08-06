/**
 * ElectronDesktopPorts
 *
 * 桌面专属 platform port 接口（spec 5.4）。定义 renderer 侧消费的 4 个 port：
 * DesktopWindowPort / DesktopUpdaterPort / DesktopSystemTrayPort / DesktopNativeFilePort。
 *
 * 这些接口仅描述 renderer 可调用的能力，不包含 Electron 类型依赖——具体实现经由
 * ElectronPreloadBridge 跨 contextIsolation 传入。shared/ui 层永远不引用这些类型
 * （spec 约束：DesktopPlatformApi 仅注入 extensions.features/）。
 *
 * DesktopNativeFilePort 同时满足 shared FileSelectionPort（selectFiles），使
 * ElectronFrontendPlatform.files 能委托到原生文件选择。
 */
import type { FrontendFileReference } from "@novel/ui";

/** 窗口操作 port：minimize / maximize / close / setAlwaysOnTop / setFullscreen。 */
export interface DesktopWindowPort {
  minimize(): Promise<void>;
  maximize(): Promise<void>;
  close(): Promise<void>;
  setAlwaysOnTop(alwaysOnTop: boolean): Promise<void>;
  setFullscreen(fullscreen: boolean): Promise<void>;
}

/** 自动更新检查返回的版本元信息。 */
export interface DesktopUpdateInfo {
  readonly version: string;
  readonly releaseNotes?: string;
  readonly releaseDate?: string;
}

/** 自动更新 port：checkForUpdates / downloadUpdate / quitAndInstall。 */
export interface DesktopUpdaterPort {
  checkForUpdates(): Promise<DesktopUpdateInfo | undefined>;
  downloadUpdate(): Promise<void>;
  quitAndInstall(): Promise<void>;
}

/** 托盘菜单项：id 标识点击事件，label 显示文本，separator 分隔符。 */
export interface DesktopTrayMenuItem {
  readonly id: string;
  readonly label: string;
  readonly enabled?: boolean;
  readonly separator?: boolean;
}

/** 托盘通知请求。 */
export interface DesktopTrayNotification {
  readonly title: string;
  readonly body?: string;
}

/** 系统托盘 port：setTrayIcon / setTrayMenu / showTrayNotification。 */
export interface DesktopSystemTrayPort {
  setTrayIcon(iconPath: string): Promise<void>;
  setTrayMenu(items: readonly DesktopTrayMenuItem[]): Promise<void>;
  showTrayNotification(notification: DesktopTrayNotification): Promise<void>;
}

/** 原生文件选择选项。 */
export interface DesktopFileSelectionOptions {
  readonly multiple?: boolean;
  readonly accept?: readonly string[];
}

/**
 * 原生文件 port：selectFile / selectDirectory / previewFile。
 *
 * selectFile 返回 FrontendFileReference[]（shared 类型），使本 port 可直接满足
 * shared FileSelectionPort.selectFiles。referenceId 对 renderer 不透明，main 进程
 * 维护 id -> filesystem path 映射；previewFile 通过 referenceId 触发系统预览。
 */
export interface DesktopNativeFilePort {
  selectFile(options?: DesktopFileSelectionOptions): Promise<readonly FrontendFileReference[]>;
  selectDirectory(options?: DesktopFileSelectionOptions): Promise<readonly FrontendFileReference[]>;
  previewFile(referenceId: string): Promise<void>;
}

/**
 * DesktopPlatformApi：4 个桌面 port 的聚合接口，由 DesktopRendererBootstrap 一次性
 * 构造，经 extensions/features 注入桌面专属组件。所有字段可选——bridge 缺失某个
 * 子 API 时对应字段为 undefined，消费者应做 nullish 检查。
 */
export interface DesktopPlatformApi {
  readonly window?: DesktopWindowPort;
  readonly updater?: DesktopUpdaterPort;
  readonly tray?: DesktopSystemTrayPort;
  readonly files?: DesktopNativeFilePort;
}
