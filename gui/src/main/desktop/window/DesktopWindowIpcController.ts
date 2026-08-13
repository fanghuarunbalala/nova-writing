/**
 * DesktopWindowIpcController
 *
 * 窗口操作 IPC 控制器（spec 5.4 DesktopWindowPort）。把 renderer 的
 * minimize / maximize / close / setAlwaysOnTop / setFullscreen 请求路由到
 * DesktopWindowService，统一做 sender 鉴权 + ElectronBridgeResult 包装。
 *
 * 模式与 DesktopWorkspaceIpcController / DesktopNativeFileIpcController 一致：
 * register(ipcMain) 绑定通道，dispose() 移除所有 handler。
 */
import { noopLogger, type Logger } from "@novel/core";
import type { ElectronIpcMainPort } from "../../ipc/index.js";
import {
  ELECTRON_WINDOW_IPC_CHANNEL,
  ELECTRON_WINDOW_IPC_CHANNELS,
  type ElectronBridgeAcknowledgement,
  type ElectronBridgeResult,
} from "../../../shared/index.js";
import type { DesktopWindowServicePort } from "./DesktopWindowService.js";

export interface DesktopWindowIpcControllerOptions {
  readonly service: DesktopWindowServicePort;
  readonly authorizeSender: (senderId: number) => boolean;
  readonly logger?: Logger;
}

export class DesktopWindowIpcController {
  private readonly service: DesktopWindowServicePort;
  private readonly authorizeSender: (senderId: number) => boolean;
  private readonly logger: Logger;
  private ipcMain?: ElectronIpcMainPort;

  constructor(options: DesktopWindowIpcControllerOptions) {
    this.service = options.service;
    this.authorizeSender = options.authorizeSender;
    this.logger = (options.logger ?? noopLogger).child({
      component: "desktop_window_ipc_controller",
    });
  }

  register(ipcMain: ElectronIpcMainPort): void {
    if (this.ipcMain !== undefined) return;
    this.ipcMain = ipcMain;
    ipcMain.handle(ELECTRON_WINDOW_IPC_CHANNEL.minimize, (event) =>
      this.execute(event.sender.id, async (senderId) => {
        await this.service.minimize(senderId);
        return Object.freeze({ acknowledged: true as const });
      }),
    );
    ipcMain.handle(ELECTRON_WINDOW_IPC_CHANNEL.maximize, (event) =>
      this.execute(event.sender.id, async (senderId) => {
        await this.service.maximize(senderId);
        return Object.freeze({ acknowledged: true as const });
      }),
    );
    ipcMain.handle(ELECTRON_WINDOW_IPC_CHANNEL.close, (event) =>
      this.execute(event.sender.id, async (senderId) => {
        await this.service.close(senderId);
        return Object.freeze({ acknowledged: true as const });
      }),
    );
    ipcMain.handle(
      ELECTRON_WINDOW_IPC_CHANNEL.alwaysOnTopSet,
      (event, alwaysOnTop) =>
        this.execute(event.sender.id, async (senderId) => {
          await this.service.setAlwaysOnTop(senderId, requireBoolean(alwaysOnTop, "alwaysOnTop"));
          return Object.freeze({ acknowledged: true as const });
        }),
    );
    ipcMain.handle(
      ELECTRON_WINDOW_IPC_CHANNEL.fullscreenSet,
      (event, fullscreen) =>
        this.execute(event.sender.id, async (senderId) => {
          await this.service.setFullscreen(senderId, requireBoolean(fullscreen, "fullscreen"));
          return Object.freeze({ acknowledged: true as const });
        }),
    );
    this.logger.info("desktop_window_ipc.registered");
  }

  releaseSender(senderId: number): Promise<void> {
    return this.service.releaseSender(senderId);
  }

  dispose(): Promise<void> {
    if (this.ipcMain !== undefined) {
      for (const channel of ELECTRON_WINDOW_IPC_CHANNELS) {
        this.ipcMain.removeHandler(channel);
      }
      this.ipcMain = undefined;
    }
    this.logger.info("desktop_window_ipc.disposed");
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
      this.logger.info("desktop_window_ipc.operation_failed", {
        errorCode: code,
      });
      return failure(code, code === "ELECTRON_WINDOW_NOT_AVAILABLE");
    }
  }
}

function captureSenderId(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new DesktopWindowProtocolError();
  }
  return value as number;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new DesktopWindowProtocolError(`${label} is invalid`);
  }
  return value;
}

function captureErrorCode(error: unknown): string {
  if (
    error !== null &&
    typeof error === "object" &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return "DESKTOP_WINDOW_OPERATION_FAILED";
}

function failure(code: string, retryable: boolean): ElectronBridgeResult<never> {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code, retryable }),
  });
}

class DesktopWindowProtocolError extends Error {
  readonly code = "ELECTRON_WINDOW_IPC_PROTOCOL_ERROR";
}

export type { ElectronBridgeAcknowledgement };
