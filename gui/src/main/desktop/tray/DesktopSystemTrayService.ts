/**
 * DesktopSystemTrayService
 *
 * 系统托盘服务（spec 5.4 DesktopSystemTrayPort）。包装 Electron Tray +
 * Notification，向 renderer 暴露 setTrayIcon / setTrayMenu / showTrayNotification。
 *
 * 设计约束：
 * - 仓库内暂无图标资产：setTrayIcon(path) 在 path 为空或文件不存在时记录 warn
 *   并跳过 tray 创建（graceful degradation），不抛错。这保证端口可用，后续接入
 *   图标资产时无需改代码
 * - tray 实例 lazily 创建：首次 setTrayIcon / setTrayMenu / showTrayNotification
 *   时若 tray 不存在且 icon 可用，则创建 Tray；tray 已存在则更新 icon
 * - setTrayMenu 的 items 经 JSON 序列化跨 IPC 传入；点击事件通过 context menu
 *   commandId 触发，Phase B.3 暂不回传 renderer（仅渲染菜单）
 * - showTrayNotification 优先使用 Tray.displayBalloon（Windows）/ Notification
 *   （跨平台 fallback）；保持调用方语义简单
 *
 * Tray / Notification / ImagePort 经接口注入便于测试。
 */
import { noopLogger, type Logger } from "@novel/core";
import type {
  DesktopTrayMenuItem,
  DesktopTrayNotification,
} from "../../../shared/index.js";

/**
 * Electron Tray 抽象端口：仅声明 service 实际使用的方法子集。
 * setImage 接受 icon path；setContextMenu 接受 menu items；displayBalloon
 * 用于 Windows 系统通知；destroy 在 dispose 时清理。
 */
export interface ElectronTrayPort {
  setImage(path: string): void;
  setToolTip(text: string): void;
  setContextMenu(items: readonly DesktopTrayMenuItem[]): void;
  displayBalloon(options: {
    readonly title?: string;
    readonly content?: string;
  }): void;
  destroy(): void;
  isDestroyed(): boolean;
}

/** Electron Notification 抽象端口（跨平台通知 fallback）。 */
export interface ElectronNotificationPort {
  show(options: { readonly title: string; readonly body?: string }): void;
}

/** Tray 工厂：根据 icon path 创建 Tray 实例；path 不可用时返回 undefined。 */
export interface ElectronTrayFactory {
  create(iconPath: string): ElectronTrayPort | undefined;
}

export interface DesktopSystemTrayServiceOptions {
  readonly trayFactory: ElectronTrayFactory;
  readonly notification: ElectronNotificationPort;
  readonly logger?: Logger;
}

export interface DesktopSystemTrayServicePort {
  setTrayIcon(senderId: number, iconPath: string): Promise<void>;
  setTrayMenu(senderId: number, items: readonly DesktopTrayMenuItem[]): Promise<void>;
  showTrayNotification(
    senderId: number,
    notification: DesktopTrayNotification,
  ): Promise<void>;
  releaseSender(senderId: number): Promise<void>;
  dispose(): Promise<void>;
}

export class DesktopSystemTrayService implements DesktopSystemTrayServicePort {
  private readonly trayFactory: ElectronTrayFactory;
  private readonly notification: ElectronNotificationPort;
  private readonly logger: Logger;
  private tray?: ElectronTrayPort;
  private menu?: readonly DesktopTrayMenuItem[];

  constructor(options: DesktopSystemTrayServiceOptions) {
    this.trayFactory = options.trayFactory;
    this.notification = options.notification;
    this.logger = (options.logger ?? noopLogger).child({
      component: "desktop_system_tray_service",
    });
  }

  async setTrayIcon(senderId: number, iconPath: string): Promise<void> {
    if (typeof iconPath !== "string" || iconPath.trim().length === 0) {
      // 与 plan 一致：空 path 不抛错，记录 warn 并跳过 tray 创建。
      this.logger.warn("desktop_system_tray.icon_path_empty", { senderId });
      return;
    }
    if (this.tray === undefined) {
      const tray = this.trayFactory.create(iconPath);
      if (tray === undefined) {
        // 资产缺失或平台不支持；保持端口可用，后续接入资产再创建。
        this.logger.warn("desktop_system_tray.create_skipped", { senderId, iconPath });
        return;
      }
      this.tray = tray;
      this.logger.info("desktop_system_tray.created", { senderId });
      if (this.menu !== undefined) {
        // icon 创建前缓存的 menu 现在回放
        tray.setContextMenu(this.menu);
      }
      return;
    }
    if (this.tray.isDestroyed()) {
      this.tray = undefined;
      return this.setTrayIcon(senderId, iconPath);
    }
    this.tray.setImage(iconPath);
    this.logger.debug("desktop_system_tray.icon_updated", { senderId });
  }

  async setTrayMenu(
    senderId: number,
    items: readonly DesktopTrayMenuItem[],
  ): Promise<void> {
    const normalized = Object.freeze(
      items.map((item) =>
        Object.freeze({
          id: item.id,
          label: item.label,
          ...(item.enabled !== undefined ? { enabled: item.enabled } : {}),
          ...(item.separator !== undefined ? { separator: item.separator } : {}),
        }),
      ),
    );
    this.menu = normalized;
    if (this.tray !== undefined && !this.tray.isDestroyed()) {
      this.tray.setContextMenu(normalized);
    }
    this.logger.debug("desktop_system_tray.menu_set", {
      senderId,
      itemCount: normalized.length,
    });
  }

  async showTrayNotification(
    senderId: number,
    notification: DesktopTrayNotification,
  ): Promise<void> {
    const payload = Object.freeze({
      title: notification.title,
      ...(notification.body !== undefined ? { body: notification.body } : {}),
    });
    // 优先使用跨平台 Notification；Tray.displayBalloon 仅 Windows。
    this.notification.show(payload);
    this.logger.info("desktop_system_tray.notification_shown", { senderId });
  }

  releaseSender(senderId: number): Promise<void> {
    this.logger.debug("desktop_system_tray.sender_released", { senderId });
    return Promise.resolve();
  }

  dispose(): Promise<void> {
    if (this.tray !== undefined && !this.tray.isDestroyed()) {
      this.tray.destroy();
    }
    this.tray = undefined;
    this.menu = undefined;
    this.logger.info("desktop_system_tray.disposed");
    return Promise.resolve();
  }
}

export class DesktopSystemTrayError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = "DesktopSystemTrayError";
  }
}
