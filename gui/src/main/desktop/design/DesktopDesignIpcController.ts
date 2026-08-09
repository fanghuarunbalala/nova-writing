/**
 * DesktopDesignIpcController
 *
 * 设计草稿文件读写 IPC 控制器：把 renderer 的 design.read / design.write 路由到
 * DesktopDesignFileService，统一做 sender 鉴权 + ElectronBridgeResult 包装。
 */
import { noopLogger, type Logger } from "@novel/core";
import type { ElectronIpcMainPort } from "../../ipc/index.js";
import {
  ELECTRON_DESIGN_IPC_CHANNEL,
  ELECTRON_DESIGN_IPC_CHANNELS,
  type ElectronBridgeAcknowledgement,
  type ElectronBridgeResult,
  type ElectronDesignFileSnapshot,
} from "../../../shared/index.js";
import type { DesktopDesignFileServicePort } from "./DesktopDesignFileService.js";

export interface DesktopDesignIpcControllerOptions {
  readonly service: DesktopDesignFileServicePort;
  readonly authorizeSender: (senderId: number) => boolean;
  readonly logger?: Logger;
}

export class DesktopDesignIpcController {
  readonly #service: DesktopDesignFileServicePort;
  readonly #authorizeSender: (senderId: number) => boolean;
  readonly #logger: Logger;
  #ipcMain?: ElectronIpcMainPort;

  constructor(options: DesktopDesignIpcControllerOptions) {
    this.#service = options.service;
    this.#authorizeSender = options.authorizeSender;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "desktop_design_ipc_controller",
    });
  }

  register(ipcMain: ElectronIpcMainPort): void {
    if (this.#ipcMain !== undefined) return;
    this.#ipcMain = ipcMain;
    ipcMain.handle(ELECTRON_DESIGN_IPC_CHANNEL.read, (event, conversationId) =>
      this.#execute(
        event.sender.id,
        (senderId) =>
          this.#service.read(senderId, requireConversationId(conversationId)),
      ),
    );
    ipcMain.handle(
      ELECTRON_DESIGN_IPC_CHANNEL.write,
      (event, conversationId, content) =>
        this.#execute(
          event.sender.id,
          (senderId) =>
            this.#service.write(
              senderId,
              requireConversationId(conversationId),
              requireContent(content),
            ),
        ),
    );
    this.#logger.info("desktop_design_ipc.registered");
  }

  dispose(): Promise<void> {
    const ipcMain = this.#ipcMain;
    this.#ipcMain = undefined;
    if (ipcMain === undefined) return Promise.resolve();
    for (const channel of ELECTRON_DESIGN_IPC_CHANNELS) {
      ipcMain.removeHandler(channel);
    }
    this.#logger.info("desktop_design_ipc.disposed");
    return Promise.resolve();
  }

  releaseSender(_senderId: number): Promise<void> {
    return Promise.resolve();
  }

  async #execute<TValue>(
    senderId: number,
    run: (senderId: number) => Promise<ElectronBridgeResult<TValue>>,
  ): Promise<ElectronBridgeResult<TValue>> {
    if (!this.#authorizeSender(senderId)) {
      return { ok: false, error: Object.freeze({ code: "unauthorized", retryable: false }) };
    }
    try {
      return await run(senderId);
    } catch (error) {
      this.#logger.error("desktop_design_ipc.failed", {
        failure: error instanceof Error ? error.name : "unknown",
      });
      return { ok: false, error: Object.freeze({ code: "design_ipc_failed", retryable: true }) };
    }
  }
}

function requireConversationId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("conversationId is invalid");
  }
  return value;
}

function requireContent(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("content is invalid");
  }
  return value;
}

export type {
  ElectronBridgeAcknowledgement,
  ElectronBridgeResult,
  ElectronDesignFileSnapshot,
};
