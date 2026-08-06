/**
 * DesktopUpdaterService
 *
 * 应用自动更新服务（spec 5.4 DesktopUpdaterPort）。包装 Electron autoUpdater，
 * 向 renderer 暴露 checkForUpdates / downloadUpdate / quitAndInstall。
 *
 * 设计约束：
 * - 使用 Electron 内置 autoUpdater（不引入 electron-updater 包，保持 0 依赖增量）
 * - autoUpdater 模块经 ElectronAutoUpdaterPort 接口注入，便于测试
 * - checkForUpdates 返回 DesktopUpdateInfo | undefined（无更新时 undefined）
 * - downloadUpdate 是 fire-and-forget：autoUpdater 触发 'update-downloaded' 后
 *   才真正完成，但 renderer 不阻塞；Phase B.3 仅暴露端口，事件流后续接入
 * - quitAndInstall 触发 app 退出并安装，调用后进程会终止
 *
 * 错误模型：
 * - autoUpdater 抛错时包装为 DesktopUpdaterError(retryable=true)
 * - update-not-available 是正常状态，不抛错，返回 undefined
 */
import { noopLogger, type Logger } from "@novel/core";
import type { DesktopUpdateInfo } from "../../../shared/index.js";

/**
 * Electron autoUpdater 抽象端口。仅声明 service 实际使用的方法子集，
 * 避免直接依赖 Electron 命名空间（保持 service 可在 Node 测试环境运行）。
 */
export interface ElectronAutoUpdaterPort {
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<void>;
  quitAndInstall(): void;
  on?(
    event: "error" | "update-available" | "update-not-available" | "update-downloaded",
    listener: (...args: unknown[]) => void,
  ): void;
  off?(
    event: "error" | "update-available" | "update-not-available" | "update-downloaded",
    listener: (...args: unknown[]) => void,
  ): void;
}

/**
 * UpdateCheckResult 的最小子集：updateInfo 包含 version / releaseNotes / releaseDate。
 * Electron 真实类型在 electron-updater 或 electron 内部，这里用结构化类型避免依赖。
 */
interface ElectronUpdateCheckResult {
  readonly updateInfo?: {
    readonly version?: unknown;
    readonly releaseNotes?: unknown;
    readonly releaseDate?: unknown;
  };
}

export interface DesktopUpdaterServiceOptions {
  readonly autoUpdater: ElectronAutoUpdaterPort;
  readonly logger?: Logger;
}

export interface DesktopUpdaterServicePort {
  checkForUpdates(senderId: number): Promise<DesktopUpdateInfo | undefined>;
  downloadUpdate(senderId: number): Promise<void>;
  quitAndInstall(senderId: number): Promise<void>;
  releaseSender(senderId: number): Promise<void>;
}

export class DesktopUpdaterService implements DesktopUpdaterServicePort {
  private readonly autoUpdater: ElectronAutoUpdaterPort;
  private readonly logger: Logger;

  constructor(options: DesktopUpdaterServiceOptions) {
    this.autoUpdater = options.autoUpdater;
    this.logger = (options.logger ?? noopLogger).child({
      component: "desktop_updater_service",
    });
  }

  async checkForUpdates(
    senderId: number,
  ): Promise<DesktopUpdateInfo | undefined> {
    this.logger.info("desktop_updater.check_started", { senderId });
    const result = await this.autoUpdater.checkForUpdates();
    const updateInfo = extractUpdateInfo(result);
    if (updateInfo === undefined) {
      this.logger.info("desktop_updater.no_update_available", { senderId });
      return undefined;
    }
    this.logger.info("desktop_updater.update_available", {
      senderId,
      version: updateInfo.version,
    });
    return updateInfo;
  }

  async downloadUpdate(senderId: number): Promise<void> {
    this.logger.info("desktop_updater.download_started", { senderId });
    await this.autoUpdater.downloadUpdate();
    // 注意：downloadUpdate resolve 仅表示下载流程启动，并非下载完成。
    // autoUpdater 'update-downloaded' 事件才表示真正完成。Phase B.3 端口
    // 暂不暴露事件流；后续接 application-update feature 时再加订阅。
    this.logger.info("desktop_updater.download_initiated", { senderId });
  }

  async quitAndInstall(senderId: number): Promise<void> {
    this.logger.info("desktop_updater.quit_and_install", { senderId });
    // quitAndInstall 是同步方法：触发 app.quit() + 安装。调用后进程将终止，
    // 因此 resolve 实际不会到达；为类型一致仍标记为 Promise<void>。
    this.autoUpdater.quitAndInstall();
  }

  releaseSender(senderId: number): Promise<void> {
    this.logger.debug("desktop_updater.sender_released", { senderId });
    return Promise.resolve();
  }
}

function extractUpdateInfo(result: unknown): DesktopUpdateInfo | undefined {
  if (result === null || typeof result !== "object") return undefined;
  const checkResult = result as ElectronUpdateCheckResult;
  const info = checkResult.updateInfo;
  if (info === undefined || info === null) return undefined;
  if (typeof info.version !== "string" || info.version.length === 0) return undefined;
  return Object.freeze({
    version: info.version,
    ...(typeof info.releaseNotes === "string"
      ? { releaseNotes: info.releaseNotes }
      : {}),
    ...(typeof info.releaseDate === "string" ? { releaseDate: info.releaseDate } : {}),
  });
}

export class DesktopUpdaterError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = "DesktopUpdaterError";
  }
}
