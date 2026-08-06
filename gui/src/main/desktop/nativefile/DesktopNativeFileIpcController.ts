/**
 * DesktopNativeFileIpcController
 *
 * 原生文件选择 IPC 控制器（spec 5.4 DesktopNativeFilePort）。把 renderer 的
 * selectFile / selectDirectory / previewFile 请求路由到 DesktopNativeFileService，
 * 统一做 sender 鉴权 + ElectronBridgeResult 包装。
 *
 * 模式与 DesktopWorkspaceIpcController 一致：register(ipcMain) 绑定通道，
 * dispose() 移除所有 handler。
 */
import { noopLogger, type Logger } from "@novel/core";
import type { ElectronIpcMainPort } from "../../ipc/index.js";
import {
  ELECTRON_NATIVE_FILE_IPC_CHANNEL,
  ELECTRON_NATIVE_FILE_IPC_CHANNELS,
  type ElectronBridgeAcknowledgement,
  type ElectronBridgeResult,
  type DesktopFileSelectionOptions,
} from "../../../shared/index.js";
import type { DesktopNativeFileServicePort } from "./DesktopNativeFileService.js";

export interface DesktopNativeFileIpcControllerOptions {
  readonly service: DesktopNativeFileServicePort;
  readonly authorizeSender: (senderId: number) => boolean;
  readonly logger?: Logger;
}

export class DesktopNativeFileIpcController {
  private readonly service: DesktopNativeFileServicePort;
  private readonly authorizeSender: (senderId: number) => boolean;
  private readonly logger: Logger;
  private ipcMain?: ElectronIpcMainPort;

  constructor(options: DesktopNativeFileIpcControllerOptions) {
    this.service = options.service;
    this.authorizeSender = options.authorizeSender;
    this.logger = (options.logger ?? noopLogger).child({
      component: "desktop_native_file_ipc_controller",
    });
  }

  register(ipcMain: ElectronIpcMainPort): void {
    if (this.ipcMain !== undefined) return;
    this.ipcMain = ipcMain;
    ipcMain.handle(ELECTRON_NATIVE_FILE_IPC_CHANNEL.selectFile, (event, options) =>
      this.execute(event.sender.id, (senderId) =>
        this.service.selectFile(senderId, captureOptions(options)),
      ),
    );
    ipcMain.handle(
      ELECTRON_NATIVE_FILE_IPC_CHANNEL.selectDirectory,
      (event, options) =>
        this.execute(event.sender.id, (senderId) =>
          this.service.selectDirectory(senderId, captureOptions(options)),
        ),
    );
    ipcMain.handle(ELECTRON_NATIVE_FILE_IPC_CHANNEL.preview, (event, referenceId) =>
      this.execute(event.sender.id, async (senderId) => {
        await this.service.previewFile(senderId, requireNonBlank(referenceId, "referenceId"));
        return Object.freeze({ acknowledged: true as const });
      }),
    );
    this.logger.info("desktop_native_file_ipc.registered");
  }

  releaseSender(senderId: number): Promise<void> {
    return this.service.releaseSender(senderId);
  }

  dispose(): Promise<void> {
    if (this.ipcMain !== undefined) {
      for (const channel of ELECTRON_NATIVE_FILE_IPC_CHANNELS) {
        this.ipcMain.removeHandler(channel);
      }
      this.ipcMain = undefined;
    }
    this.logger.info("desktop_native_file_ipc.disposed");
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
      this.logger.info("desktop_native_file_ipc.operation_failed", {
        errorCode: code,
      });
      return failure(code, code === "DESKTOP_NATIVE_FILE_OPERATION_FAILED");
    }
  }
}

function captureOptions(value: unknown): DesktopFileSelectionOptions | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new DesktopNativeFileProtocolError();
  }
  const record = value as Record<string, unknown>;
  const options: { multiple?: boolean; accept?: readonly string[] } = {};
  if (record.multiple !== undefined) {
    if (typeof record.multiple !== "boolean") throw new DesktopNativeFileProtocolError();
    options.multiple = record.multiple;
  }
  if (record.accept !== undefined) {
    if (!Array.isArray(record.accept) || record.accept.some((t) => typeof t !== "string")) {
      throw new DesktopNativeFileProtocolError();
    }
    options.accept = Object.freeze([...record.accept]);
  }
  return Object.freeze(options);
}

function captureSenderId(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new DesktopNativeFileProtocolError();
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
  return "DESKTOP_NATIVE_FILE_OPERATION_FAILED";
}

function requireNonBlank(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DesktopNativeFileProtocolError(`${label} is invalid`);
  }
  return value;
}

function failure(code: string, retryable: boolean): ElectronBridgeResult<never> {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code, retryable }),
  });
}

class DesktopNativeFileProtocolError extends Error {
  readonly code = "ELECTRON_NATIVE_FILE_IPC_PROTOCOL_ERROR";
}
