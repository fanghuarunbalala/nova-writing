/** Routes authorized Configuration IPC while keeping secrets in Electron Main. */
import {
  noopLogger,
  type ApplicationConfigurationSnapshot,
  type Logger,
  type RemoveModelConfigurationRequest,
  type SetDefaultModelProfileRequest,
  type UpsertModelConfigurationRequest,
} from "@novel/core";
import {
  ELECTRON_CONFIGURATION_IPC_CHANNEL,
  ELECTRON_CONFIGURATION_IPC_CHANNELS,
  type ElectronBridgeResult,
} from "../../shared/index.js";
import type { ElectronIpcMainPort } from "../ipc/index.js";
import type { DesktopConfigurationServicePort } from "./DesktopConfigurationService.js";

export class DesktopConfigurationIpcController {
  readonly #service: DesktopConfigurationServicePort;
  readonly #authorizeSender: (senderId: number) => boolean;
  readonly #logger: Logger;
  #ipcMain?: ElectronIpcMainPort;

  constructor(options: {
    readonly service: DesktopConfigurationServicePort;
    readonly authorizeSender: (senderId: number) => boolean;
    readonly logger?: Logger;
  }) {
    this.#service = options.service;
    this.#authorizeSender = options.authorizeSender;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "desktop_configuration_ipc_controller",
    });
  }

  register(ipcMain: ElectronIpcMainPort): void {
    if (this.#ipcMain !== undefined) return;
    this.#ipcMain = ipcMain;
    ipcMain.handle(ELECTRON_CONFIGURATION_IPC_CHANNEL.load, (event) =>
      this.#execute(event.sender.id, () => this.#service.load()),
    );
    ipcMain.handle(ELECTRON_CONFIGURATION_IPC_CHANNEL.save, (event, snapshot) =>
      this.#execute(event.sender.id, () =>
        this.#service.save(snapshot as ApplicationConfigurationSnapshot)),
    );
    ipcMain.handle(
      ELECTRON_CONFIGURATION_IPC_CHANNEL.modelUpsert,
      (event, request) =>
        this.#execute(event.sender.id, () =>
          this.#service.upsertModelConfiguration(
            request as UpsertModelConfigurationRequest,
          )),
    );
    ipcMain.handle(
      ELECTRON_CONFIGURATION_IPC_CHANNEL.modelDefaultSet,
      (event, request) =>
        this.#execute(event.sender.id, () =>
          this.#service.setDefaultModelProfile(
            request as SetDefaultModelProfileRequest,
          )),
    );
    ipcMain.handle(
      ELECTRON_CONFIGURATION_IPC_CHANNEL.modelRemove,
      (event, request) =>
        this.#execute(event.sender.id, () =>
          this.#service.removeModelConfiguration(
            request as RemoveModelConfigurationRequest,
          )),
    );
    ipcMain.handle(ELECTRON_CONFIGURATION_IPC_CHANNEL.modelProbe, (event) =>
      this.#execute(event.sender.id, () =>
        this.#service.probeModelConnection(),
      ),
    );
    ipcMain.handle(
      ELECTRON_CONFIGURATION_IPC_CHANNEL.credentialStatus,
      (event, reference) =>
        this.#execute(event.sender.id, () =>
          this.#service.getCredentialStatus(captureString(reference))),
    );
    ipcMain.handle(
      ELECTRON_CONFIGURATION_IPC_CHANNEL.credentialSave,
      (event, reference, secret) =>
        this.#execute(event.sender.id, async () => {
          await this.#service.saveCredential(
            captureString(reference),
            captureSecret(secret),
          );
          return Object.freeze({ acknowledged: true as const });
        }),
    );
    ipcMain.handle(
      ELECTRON_CONFIGURATION_IPC_CHANNEL.credentialDelete,
      (event, reference) =>
        this.#execute(event.sender.id, async () => {
          await this.#service.deleteCredential(captureString(reference));
          return Object.freeze({ acknowledged: true as const });
        }),
    );
    this.#logger.info("desktop_configuration_ipc.registered");
  }

  dispose(): Promise<void> {
    if (this.#ipcMain !== undefined) {
      for (const channel of ELECTRON_CONFIGURATION_IPC_CHANNELS) {
        this.#ipcMain.removeHandler(channel);
      }
      this.#ipcMain = undefined;
    }
    this.#logger.info("desktop_configuration_ipc.disposed");
    return Promise.resolve();
  }

  async #execute<TValue>(
    senderId: unknown,
    operation: () => Promise<TValue>,
  ): Promise<ElectronBridgeResult<TValue>> {
    try {
      if (!Number.isSafeInteger(senderId) || !this.#authorizeSender(senderId as number)) {
        return failure("ELECTRON_IPC_UNAUTHORIZED", false);
      }
      return Object.freeze({ ok: true as const, value: await operation() });
    } catch (error) {
      const record = error !== null && typeof error === "object"
        ? error as { code?: unknown; failure?: unknown; retryable?: unknown }
        : undefined;
      const code = typeof record?.code === "string"
        ? record.code
        : typeof record?.failure === "string"
        ? record.failure
        : "DESKTOP_CONFIGURATION_OPERATION_FAILED";
      const retryable = typeof record?.retryable === "boolean"
        ? record.retryable
        : code === "DESKTOP_CONFIGURATION_OPERATION_FAILED";
      this.#logger.info("desktop_configuration_ipc.operation_failed", { errorCode: code });
      return failure(code, retryable);
    }
  }
}

function captureString(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("Configuration IPC string is invalid");
  }
  return value;
}

function captureSecret(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 1_048_576) {
    throw new TypeError("Configuration IPC secret is invalid");
  }
  return value;
}

function failure(code: string, retryable: boolean): ElectronBridgeResult<never> {
  return Object.freeze({ ok: false, error: Object.freeze({ code, retryable }) });
}
