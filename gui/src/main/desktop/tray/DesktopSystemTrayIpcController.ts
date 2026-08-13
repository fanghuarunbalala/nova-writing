/**
 * DesktopSystemTrayIpcController
 *
 * 系统托盘 IPC 控制器（spec 5.4 DesktopSystemTrayPort）。把 renderer 的
 * setTrayIcon / setTrayMenu / showTrayNotification 请求路由到
 * DesktopSystemTrayService，统一做 sender 鉴权 + ElectronBridgeResult 包装。
 *
 * 模式与 DesktopWindowIpcController / DesktopNativeFileIpcController 一致。
 */
import { noopLogger, type Logger } from "@novel/core";
import type { ElectronIpcMainPort } from "../../ipc/index.js";
import {
  ELECTRON_SYSTEM_TRAY_IPC_CHANNEL,
  ELECTRON_SYSTEM_TRAY_IPC_CHANNELS,
  type ElectronBridgeAcknowledgement,
  type ElectronBridgeResult,
  type DesktopTrayMenuItem,
  type DesktopTrayNotification,
} from "../../../shared/index.js";
import type { DesktopSystemTrayServicePort } from "./DesktopSystemTrayService.js";

export interface DesktopSystemTrayIpcControllerOptions {
  readonly service: DesktopSystemTrayServicePort;
  readonly authorizeSender: (senderId: number) => boolean;
  readonly logger?: Logger;
}

export class DesktopSystemTrayIpcController {
  private readonly service: DesktopSystemTrayServicePort;
  private readonly authorizeSender: (senderId: number) => boolean;
  private readonly logger: Logger;
  private ipcMain?: ElectronIpcMainPort;

  constructor(options: DesktopSystemTrayIpcControllerOptions) {
    this.service = options.service;
    this.authorizeSender = options.authorizeSender;
    this.logger = (options.logger ?? noopLogger).child({
      component: "desktop_system_tray_ipc_controller",
    });
  }

  register(ipcMain: ElectronIpcMainPort): void {
    if (this.ipcMain !== undefined) return;
    this.ipcMain = ipcMain;
    ipcMain.handle(ELECTRON_SYSTEM_TRAY_IPC_CHANNEL.iconSet, (event, iconPath) =>
      this.execute(event.sender.id, async (senderId) => {
        await this.service.setTrayIcon(senderId, requireNonBlank(iconPath, "iconPath"));
        return Object.freeze({ acknowledged: true as const });
      }),
    );
    ipcMain.handle(ELECTRON_SYSTEM_TRAY_IPC_CHANNEL.menuSet, (event, items) =>
      this.execute(event.sender.id, async (senderId) => {
        await this.service.setTrayMenu(senderId, captureMenu(items));
        return Object.freeze({ acknowledged: true as const });
      }),
    );
    ipcMain.handle(
      ELECTRON_SYSTEM_TRAY_IPC_CHANNEL.notificationShow,
      (event, notification) =>
        this.execute(event.sender.id, async (senderId) => {
          await this.service.showTrayNotification(
            senderId,
            captureNotification(notification),
          );
          return Object.freeze({ acknowledged: true as const });
        }),
    );
    this.logger.info("desktop_system_tray_ipc.registered");
  }

  releaseSender(senderId: number): Promise<void> {
    return this.service.releaseSender(senderId);
  }

  dispose(): Promise<void> {
    if (this.ipcMain !== undefined) {
      for (const channel of ELECTRON_SYSTEM_TRAY_IPC_CHANNELS) {
        this.ipcMain.removeHandler(channel);
      }
      this.ipcMain = undefined;
    }
    this.logger.info("desktop_system_tray_ipc.disposed");
    return Promise.resolve();
  }

  private async execute<TValue>(
    senderValue: unknown,
    operation: (senderId: number) => Promise<TValue>,
  ): Promise<ElectronBridgeResult<TValue>> {
    try {
      const senderId = captureSenderId(senderValue);
      if (!this.authorizeSender(senderId)) {
        return failure("ELECTRON_IPC_UNAUTHORIZED", false);
      }
      return { ok: true, value: await operation(senderId) };
    } catch (error) {
      const code = captureErrorCode(error);
      this.logger.info("desktop_system_tray_ipc.operation_failed", {
        errorCode: code,
      });
      return failure(code, code === "DESKTOP_SYSTEM_TRAY_OPERATION_FAILED");
    }
  }
}

function captureSenderId(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new DesktopSystemTrayProtocolError();
  }
  return value as number;
}

function requireNonBlank(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DesktopSystemTrayProtocolError(`${label} is invalid`);
  }
  return value;
}

function captureMenu(value: unknown): readonly DesktopTrayMenuItem[] {
  if (!Array.isArray(value)) {
    throw new DesktopSystemTrayProtocolError();
  }
  return Object.freeze(
    value.map((entry, index) => {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        throw new DesktopSystemTrayProtocolError(`menu[${index}] is invalid`);
      }
      const record = entry as Record<string, unknown>;
      if (typeof record.id !== "string" || record.id.length === 0) {
        throw new DesktopSystemTrayProtocolError(`menu[${index}].id is invalid`);
      }
      if (typeof record.label !== "string") {
        throw new DesktopSystemTrayProtocolError(`menu[${index}].label is invalid`);
      }
      const item: {
        id: string;
        label: string;
        enabled?: boolean;
        separator?: boolean;
      } = { id: record.id, label: record.label };
      if (record.enabled !== undefined) {
        if (typeof record.enabled !== "boolean") {
          throw new DesktopSystemTrayProtocolError(`menu[${index}].enabled is invalid`);
        }
        item.enabled = record.enabled;
      }
      if (record.separator !== undefined) {
        if (typeof record.separator !== "boolean") {
          throw new DesktopSystemTrayProtocolError(`menu[${index}].separator is invalid`);
        }
        item.separator = record.separator;
      }
      return Object.freeze(item);
    }),
  );
}

function captureNotification(value: unknown): DesktopTrayNotification {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new DesktopSystemTrayProtocolError();
  }
  const record = value as Record<string, unknown>;
  if (typeof record.title !== "string" || record.title.trim().length === 0) {
    throw new DesktopSystemTrayProtocolError("notification.title is invalid");
  }
  const notification: { title: string; body?: string } = { title: record.title };
  if (record.body !== undefined) {
    if (typeof record.body !== "string") {
      throw new DesktopSystemTrayProtocolError("notification.body is invalid");
    }
    notification.body = record.body;
  }
  return Object.freeze(notification);
}

function captureErrorCode(error: unknown): string {
  if (
    error !== null &&
    typeof error === "object" &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return "DESKTOP_SYSTEM_TRAY_OPERATION_FAILED";
}

function failure(code: string, retryable: boolean): ElectronBridgeResult<never> {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code, retryable }),
  });
}

class DesktopSystemTrayProtocolError extends Error {
  readonly code = "ELECTRON_SYSTEM_TRAY_IPC_PROTOCOL_ERROR";
}

export type { ElectronBridgeAcknowledgement };
