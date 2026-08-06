/**
 * DesktopUpdaterIpcController
 *
 * 自动更新 IPC 控制器（spec 5.4 DesktopUpdaterPort）。把 renderer 的
 * checkForUpdates / downloadUpdate / quitAndInstall 请求路由到
 * DesktopUpdaterService，统一做 sender 鉴权 + ElectronBridgeResult 包装。
 *
 * 模式与 DesktopWindowIpcController / DesktopNativeFileIpcController 一致。
 */
import { noopLogger, type Logger } from "@novel/core";
import type { ElectronIpcMainPort } from "../../ipc/index.js";
import {
  ELECTRON_UPDATER_IPC_CHANNEL,
  ELECTRON_UPDATER_IPC_CHANNELS,
  type ElectronBridgeAcknowledgement,
  type ElectronBridgeResult,
} from "../../../shared/index.js";
import type { DesktopUpdaterServicePort } from "./DesktopUpdaterService.js";

export interface DesktopUpdaterIpcControllerOptions {
  readonly service: DesktopUpdaterServicePort;
  readonly authorizeSender: (senderId: number) => boolean;
  readonly logger?: Logger;
}

export class DesktopUpdaterIpcController {
  private readonly service: DesktopUpdaterServicePort;
  private readonly authorizeSender: (senderId: number) => boolean;
  private readonly logger: Logger;
  private ipcMain?: ElectronIpcMainPort;

  constructor(options: DesktopUpdaterIpcControllerOptions) {
    this.service = options.service;
    this.authorizeSender = options.authorizeSender;
    this.logger = (options.logger ?? noopLogger).child({
      component: "desktop_updater_ipc_controller",
    });
  }

  register(ipcMain: ElectronIpcMainPort): void {
    if (this.ipcMain !== undefined) return;
    this.ipcMain = ipcMain;
    ipcMain.handle(ELECTRON_UPDATER_IPC_CHANNEL.check, (event) =>
      this.execute(event.sender.id, (senderId) => this.service.checkForUpdates(senderId)),
    );
    ipcMain.handle(ELECTRON_UPDATER_IPC_CHANNEL.download, (event) =>
      this.execute(event.sender.id, async (senderId) => {
        await this.service.downloadUpdate(senderId);
        return Object.freeze({ acknowledged: true as const });
      }),
    );
    ipcMain.handle(ELECTRON_UPDATER_IPC_CHANNEL.quitAndInstall, (event) =>
      this.execute(event.sender.id, async (senderId) => {
        await this.service.quitAndInstall(senderId);
        return Object.freeze({ acknowledged: true as const });
      }),
    );
    this.logger.info("desktop_updater_ipc.registered");
  }

  releaseSender(senderId: number): Promise<void> {
    return this.service.releaseSender(senderId);
  }

  dispose(): Promise<void> {
    if (this.ipcMain !== undefined) {
      for (const channel of ELECTRON_UPDATER_IPC_CHANNELS) {
        this.ipcMain.removeHandler(channel);
      }
      this.ipcMain = undefined;
    }
    this.logger.info("desktop_updater_ipc.disposed");
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
      this.logger.info("desktop_updater_ipc.operation_failed", {
        errorCode: code,
      });
      return failure(code, code === "DESKTOP_UPDATER_OPERATION_FAILED");
    }
  }
}

function captureSenderId(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new DesktopUpdaterProtocolError();
  }
  return value as number;
}

function captureErrorCode(error: unknown): string {
  if (
    error !== null &&
    typeof error === "object" &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return "DESKTOP_UPDATER_OPERATION_FAILED";
}

function failure(code: string, retryable: boolean): ElectronBridgeResult<never> {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code, retryable }),
  });
}

class DesktopUpdaterProtocolError extends Error {
  readonly code = "ELECTRON_UPDATER_IPC_PROTOCOL_ERROR";
}

export type { ElectronBridgeAcknowledgement };
