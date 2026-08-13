/** Routes authorized Workspace IPC without exposing Main filesystem paths. */
import { noopLogger, type Logger } from "@novel/core";
import type { ElectronIpcMainPort } from "../ipc/index.js";
import {
  ELECTRON_WORKSPACE_IPC_CHANNEL,
  ELECTRON_WORKSPACE_IPC_CHANNELS,
  type ElectronBridgeResult,
  type ElectronWorkspaceReference,
} from "../../shared/index.js";
import type { DesktopWorkspaceServicePort } from "./DesktopWorkspaceService.js";

export interface DesktopWorkspaceIpcControllerOptions {
  readonly service: DesktopWorkspaceServicePort;
  readonly authorizeSender: (senderId: number) => boolean;
  readonly logger?: Logger;
}

export class DesktopWorkspaceIpcController {
  private readonly service: DesktopWorkspaceServicePort;
  private readonly authorizeSender: (senderId: number) => boolean;
  private readonly logger: Logger;
  private ipcMain?: ElectronIpcMainPort;

  constructor(options: DesktopWorkspaceIpcControllerOptions) {
    this.service = options.service;
    this.authorizeSender = options.authorizeSender;
    this.logger = (options.logger ?? noopLogger).child({
      component: "desktop_workspace_ipc_controller",
    });
  }

  register(ipcMain: ElectronIpcMainPort): void {
    if (this.ipcMain !== undefined) return;
    this.ipcMain = ipcMain;
    ipcMain.handle(ELECTRON_WORKSPACE_IPC_CHANNEL.select, (event) =>
      this.execute(event.sender.id, (senderId) => this.service.select(senderId)),
    );
    ipcMain.handle(ELECTRON_WORKSPACE_IPC_CHANNEL.listRecent, (event) =>
      this.execute(event.sender.id, (senderId) => this.service.listRecent(senderId)),
    );
    ipcMain.handle(ELECTRON_WORKSPACE_IPC_CHANNEL.open, (event, reference) =>
      this.execute(event.sender.id, (senderId) =>
        this.service.open(senderId, captureReference(reference)),
      ),
    );
    ipcMain.handle(ELECTRON_WORKSPACE_IPC_CHANNEL.close, (event) =>
      this.execute(event.sender.id, async (senderId) => {
        await this.service.close(senderId);
        return Object.freeze({ acknowledged: true as const });
      }),
    );
    this.logger.info("desktop_workspace_ipc.registered");
  }

  releaseSender(senderId: number): Promise<void> {
    return this.service.releaseSender(senderId);
  }

  dispose(): Promise<void> {
    if (this.ipcMain !== undefined) {
      for (const channel of ELECTRON_WORKSPACE_IPC_CHANNELS) {
        this.ipcMain.removeHandler(channel);
      }
      this.ipcMain = undefined;
    }
    this.logger.info("desktop_workspace_ipc.disposed");
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
      const code =
        error !== null && typeof error === "object" && typeof (error as { code?: unknown }).code === "string"
          ? (error as { code: string }).code
          : "DESKTOP_WORKSPACE_OPERATION_FAILED";
      this.logger.info("desktop_workspace_ipc.operation_failed", {
        errorCode: code,
      });
      return failure(code, code === "DESKTOP_WORKSPACE_OPERATION_FAILED");
    }
  }
}

function captureReference(value: unknown): ElectronWorkspaceReference {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new DesktopWorkspaceProtocolError();
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "label,referenceId" ||
    typeof record.referenceId !== "string" ||
    record.referenceId.trim().length === 0 ||
    typeof record.label !== "string" ||
    record.label.trim().length === 0
  ) {
    throw new DesktopWorkspaceProtocolError();
  }
  return Object.freeze({ referenceId: record.referenceId, label: record.label });
}

function captureSenderId(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new DesktopWorkspaceProtocolError();
  }
  return value as number;
}

function failure(code: string, retryable: boolean): ElectronBridgeResult<never> {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code, retryable }),
  });
}

class DesktopWorkspaceProtocolError extends Error {
  readonly code = "ELECTRON_WORKSPACE_IPC_PROTOCOL_ERROR";
}
