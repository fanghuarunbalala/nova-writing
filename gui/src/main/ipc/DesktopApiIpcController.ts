/** Main-process owner for authorized Renderer requests and subscription handles. */
import {
  API_PROTOCOL_VERSION,
  ApiTransportError,
  noopLogger,
  type ApiEventFrame,
  type ApiRequest,
  type ApiResponse,
  type ApiSubscription,
  type ApiTransport,
  type Logger,
} from "@novel/core";
import {
  ELECTRON_API_IPC_CHANNEL,
  ELECTRON_API_IPC_CHANNELS,
  type ElectronBridgeAcknowledgement,
  type ElectronBridgeOpenSubscriptionRequest,
  type ElectronBridgeResult,
  type ElectronBridgeSubscriptionRead,
} from "../../shared/index.js";

export interface ElectronIpcMainInvokeEventPort {
  readonly sender: {
    readonly id: number;
  };
}

export type ElectronIpcMainHandler = (
  event: ElectronIpcMainInvokeEventPort,
  ...args: unknown[]
) => unknown;

export interface ElectronIpcMainPort {
  handle(channel: string, handler: ElectronIpcMainHandler): void;
  removeHandler(channel: string): void;
}

export interface DesktopApiIpcControllerOptions {
  readonly transport?: ApiTransport;
  readonly resolveTransport?: (senderId: number) => ApiTransport;
  readonly authorizeSender: (senderId: number) => boolean;
  readonly logger?: Logger;
}

interface ActiveRequest {
  readonly requestId: string;
  readonly abortController: AbortController;
}

interface ActiveSubscription {
  readonly subscriptionId: string;
  readonly subscription: ApiSubscription;
  reading: boolean;
}

export class DesktopApiIpcController {
  private readonly resolveTransport: (senderId: number) => ApiTransport;
  private readonly authorizeSender: (senderId: number) => boolean;
  private readonly logger: Logger;
  private readonly requests = new Map<number, Map<string, ActiveRequest>>();
  private readonly subscriptions = new Map<
    number,
    Map<string, ActiveSubscription>
  >();
  private ipcMain?: ElectronIpcMainPort;
  private disposed = false;
  private disposePromise?: Promise<void>;

  constructor(options: DesktopApiIpcControllerOptions) {
    if (options.resolveTransport === undefined && options.transport === undefined) {
      throw new TypeError("Desktop API IPC requires a Transport resolver");
    }
    this.resolveTransport =
      options.resolveTransport ?? (() => options.transport as ApiTransport);
    this.authorizeSender = options.authorizeSender;
    this.logger = (options.logger ?? noopLogger).child({
      component: "desktop_api_ipc_controller",
    });
  }

  register(ipcMain: ElectronIpcMainPort): void {
    if (this.disposed) {
      throw new ApiTransportError(
        "ELECTRON_IPC_CONTROLLER_DISPOSED",
        false,
        "Electron IPC Controller is disposed",
      );
    }
    if (this.ipcMain !== undefined) {
      throw new ApiTransportError(
        "ELECTRON_IPC_CONTROLLER_REGISTERED",
        false,
        "Electron IPC Controller is already registered",
      );
    }
    this.ipcMain = ipcMain;
    ipcMain.handle(ELECTRON_API_IPC_CHANNEL.request, (event, request) =>
      this.handleRequest(event, request),
    );
    ipcMain.handle(
      ELECTRON_API_IPC_CHANNEL.cancelRequest,
      (event, requestId) => this.handleCancelRequest(event, requestId),
    );
    ipcMain.handle(
      ELECTRON_API_IPC_CHANNEL.openSubscription,
      (event, request) => this.handleOpenSubscription(event, request),
    );
    ipcMain.handle(
      ELECTRON_API_IPC_CHANNEL.readSubscription,
      (event, subscriptionId) =>
        this.handleReadSubscription(event, subscriptionId),
    );
    ipcMain.handle(
      ELECTRON_API_IPC_CHANNEL.closeSubscription,
      (event, subscriptionId) =>
        this.handleCloseSubscription(event, subscriptionId),
    );
    this.logger.info("electron_main_ipc.registered", {
      channelCount: ELECTRON_API_IPC_CHANNELS.length,
    });
  }

  releaseSender(senderId: number): Promise<void> {
    return this.releaseSenderOnce(validateSenderId(senderId));
  }

  dispose(): Promise<void> {
    this.disposePromise ??= this.disposeOnce();
    return this.disposePromise;
  }

  private handleRequest(
    event: ElectronIpcMainInvokeEventPort,
    value: unknown,
  ): Promise<ElectronBridgeResult<ApiResponse>> {
    return this.execute(event, "request", async (senderId) => {
      const request = validateApiRequest(value);
      const requests = getOrCreateSenderMap(this.requests, senderId);
      if (requests.has(request.requestId)) {
        throw new DesktopIpcFailure(
          "ELECTRON_REQUEST_DUPLICATE",
          false,
          "Electron request identity is already active",
        );
      }
      const abortController = new AbortController();
      requests.set(request.requestId, {
        requestId: request.requestId,
        abortController,
      });
      this.logger.debug("electron_main_ipc.request_started", {
        senderId,
        requestId: request.requestId,
        operation: request.operation,
      });
      try {
        const response = await this.resolveTransport(senderId).request(request, {
          signal: abortController.signal,
        });
        if (this.disposed) {
          throw new DesktopIpcFailure(
            "API_TRANSPORT_DISCONNECTED",
            true,
            "Electron IPC Controller is disposed",
          );
        }
        this.logger.debug("electron_main_ipc.request_completed", {
          senderId,
          requestId: request.requestId,
          operation: request.operation,
          ok: response.ok,
        });
        return response;
      } finally {
        requests.delete(request.requestId);
        deleteEmptySenderMap(this.requests, senderId, requests);
      }
    });
  }

  private handleCancelRequest(
    event: ElectronIpcMainInvokeEventPort,
    value: unknown,
  ): Promise<ElectronBridgeResult<ElectronBridgeAcknowledgement>> {
    return this.execute(event, "cancel_request", async (senderId) => {
      const requestId = requireNonBlank(value, "Electron requestId");
      const request = this.requests.get(senderId)?.get(requestId);
      request?.abortController.abort(
        new DOMException("Electron API request was cancelled", "AbortError"),
      );
      this.logger.debug("electron_main_ipc.request_cancelled", {
        senderId,
        requestId,
        active: request !== undefined,
      });
      return acknowledgement();
    });
  }

  private handleOpenSubscription(
    event: ElectronIpcMainInvokeEventPort,
    value: unknown,
  ): Promise<ElectronBridgeResult<ElectronBridgeAcknowledgement>> {
    return this.execute(event, "open_subscription", async (senderId) => {
      const openRequest = validateOpenSubscriptionRequest(value);
      const expectedSubscriptionId = `electron:${openRequest.request.requestId}`;
      if (openRequest.subscriptionId !== expectedSubscriptionId) {
        throw new DesktopIpcFailure(
          "ELECTRON_SUBSCRIPTION_ID_MISMATCH",
          false,
          "Electron subscription identity does not match its request",
        );
      }
      const existingSubscriptions = this.subscriptions.get(senderId);
      if (existingSubscriptions?.has(openRequest.subscriptionId) === true) {
        throw new DesktopIpcFailure(
          "ELECTRON_SUBSCRIPTION_DUPLICATE",
          false,
          "Electron subscription identity is already active",
        );
      }
      const subscription = this.resolveTransport(senderId).subscribe(openRequest.request);
      validateApiSubscription(subscription);
      const subscriptions = getOrCreateSenderMap(this.subscriptions, senderId);
      subscriptions.set(openRequest.subscriptionId, {
        subscriptionId: openRequest.subscriptionId,
        subscription,
        reading: false,
      });
      this.logger.info("electron_main_ipc.subscription_opened", {
        senderId,
        requestId: openRequest.request.requestId,
        operation: openRequest.request.operation,
        subscriptionId: openRequest.subscriptionId,
        subscriptionCount: subscriptions.size,
      });
      return acknowledgement();
    });
  }

  private handleReadSubscription(
    event: ElectronIpcMainInvokeEventPort,
    value: unknown,
  ): Promise<ElectronBridgeResult<ElectronBridgeSubscriptionRead>> {
    return this.execute(event, "read_subscription", async (senderId) => {
      const subscriptionId = requireNonBlank(value, "Electron subscriptionId");
      const subscriptions = this.subscriptions.get(senderId);
      const active = subscriptions?.get(subscriptionId);
      if (subscriptions === undefined || active === undefined) {
        throw new DesktopIpcFailure(
          "ELECTRON_SUBSCRIPTION_NOT_FOUND",
          false,
          "Electron subscription is not active",
        );
      }
      if (active.reading) {
        throw new DesktopIpcFailure(
          "ELECTRON_SUBSCRIPTION_READ_IN_PROGRESS",
          false,
          "Electron subscription already has an active read",
        );
      }
      active.reading = true;
      try {
        const result = await active.subscription.next();
        if (result.done) {
          subscriptions.delete(subscriptionId);
          deleteEmptySenderMap(this.subscriptions, senderId, subscriptions);
          return { done: true };
        }
        const frame = rewriteSubscriptionFrame(result.value, subscriptionId);
        this.logger.debug("electron_main_ipc.event_delivered", {
          senderId,
          subscriptionId,
          sequence: frame.event.sequence,
          direction: frame.event.direction,
          eventType: frame.event.eventType,
        });
        return { done: false, frame };
      } catch (error) {
        await Promise.allSettled([
          this.closeActiveSubscription(senderId, subscriptionId, active),
        ]);
        throw error;
      } finally {
        active.reading = false;
      }
    });
  }

  private handleCloseSubscription(
    event: ElectronIpcMainInvokeEventPort,
    value: unknown,
  ): Promise<ElectronBridgeResult<ElectronBridgeAcknowledgement>> {
    return this.execute(event, "close_subscription", async (senderId) => {
      const subscriptionId = requireNonBlank(value, "Electron subscriptionId");
      const active = this.subscriptions.get(senderId)?.get(subscriptionId);
      if (active !== undefined) {
        await this.closeActiveSubscription(senderId, subscriptionId, active);
      }
      return acknowledgement();
    });
  }

  private async execute<TValue>(
    event: ElectronIpcMainInvokeEventPort,
    operation: string,
    handler: (senderId: number) => Promise<TValue>,
  ): Promise<ElectronBridgeResult<TValue>> {
    let senderId: number | undefined;
    try {
      senderId = validateSenderId(event?.sender?.id);
      if (this.disposed) {
        throw new DesktopIpcFailure(
          "API_TRANSPORT_DISCONNECTED",
          true,
          "Electron IPC Controller is disposed",
        );
      }
      if (!this.isAuthorizedSender(senderId)) {
        throw new DesktopIpcFailure(
          "ELECTRON_IPC_UNAUTHORIZED",
          false,
          "Electron IPC sender is unauthorized",
        );
      }
      return bridgeSuccess(await handler(senderId));
    } catch (error) {
      const failure = mapBridgeFailure(error);
      this.logger.warn("electron_main_ipc.operation_failed", {
        operation,
        ...(senderId !== undefined ? { senderId } : {}),
        code: failure.error.code,
        retryable: failure.error.retryable,
      });
      return failure;
    }
  }

  private isAuthorizedSender(senderId: number): boolean {
    try {
      return this.authorizeSender(senderId) === true;
    } catch {
      return false;
    }
  }

  private async closeActiveSubscription(
    senderId: number,
    subscriptionId: string,
    active: ActiveSubscription,
  ): Promise<void> {
    const subscriptions = this.subscriptions.get(senderId);
    subscriptions?.delete(subscriptionId);
    if (subscriptions !== undefined) {
      deleteEmptySenderMap(this.subscriptions, senderId, subscriptions);
    }
    await active.subscription.close();
    this.logger.info("electron_main_ipc.subscription_closed", {
      senderId,
      subscriptionId,
    });
  }

  private async releaseSenderOnce(senderId: number): Promise<void> {
    const requests = this.requests.get(senderId);
    this.requests.delete(senderId);
    for (const request of requests?.values() ?? []) {
      request.abortController.abort(
        new DOMException("Electron IPC sender was released", "AbortError"),
      );
    }
    const subscriptions = [...(this.subscriptions.get(senderId)?.values() ?? [])];
    this.subscriptions.delete(senderId);
    const results = await Promise.allSettled(
      subscriptions.map((active) => active.subscription.close()),
    );
    const failureCount = results.filter(
      (result) => result.status === "rejected",
    ).length;
    this.logger.info("electron_main_ipc.sender_released", {
      senderId,
      requestCount: requests?.size ?? 0,
      subscriptionCount: subscriptions.length,
      failureCount,
    });
    if (failureCount > 0) {
      throw new ApiTransportError(
        "ELECTRON_SENDER_RELEASE_FAILED",
        true,
        "Electron IPC sender cleanup failed",
      );
    }
  }

  private async disposeOnce(): Promise<void> {
    this.disposed = true;
    const ipcMain = this.ipcMain;
    this.ipcMain = undefined;
    if (ipcMain !== undefined) {
      for (const channel of ELECTRON_API_IPC_CHANNELS) {
        ipcMain.removeHandler(channel);
      }
    }
    const requestEntries = [...this.requests.values()].flatMap((requests) =>
      [...requests.values()],
    );
    this.requests.clear();
    for (const request of requestEntries) {
      request.abortController.abort(
        new DOMException("Electron IPC Controller was disposed", "AbortError"),
      );
    }
    const subscriptionEntries = [...this.subscriptions.values()].flatMap(
      (subscriptions) => [...subscriptions.values()],
    );
    this.subscriptions.clear();
    const results = await Promise.allSettled(
      subscriptionEntries.map((active) => active.subscription.close()),
    );
    const failureCount = results.filter(
      (result) => result.status === "rejected",
    ).length;
    this.logger.info("electron_main_ipc.disposed", {
      requestCount: requestEntries.length,
      subscriptionCount: subscriptionEntries.length,
      failureCount,
    });
    if (failureCount > 0) {
      throw new ApiTransportError(
        "ELECTRON_IPC_DISPOSE_FAILED",
        true,
        "Electron IPC Controller cleanup failed",
      );
    }
  }
}

class DesktopIpcFailure extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = "DesktopIpcFailure";
  }
}

function validateApiRequest(value: unknown): ApiRequest {
  const request = requireRecord(value, "Electron API request");
  if (request.protocolVersion !== API_PROTOCOL_VERSION) {
    throw new DesktopIpcFailure(
      "ELECTRON_IPC_PROTOCOL_ERROR",
      false,
      "Electron API request protocol version is incompatible",
    );
  }
  const captured: ApiRequest = {
    protocolVersion: API_PROTOCOL_VERSION,
    requestId: requireNonBlank(request.requestId, "Electron requestId"),
    operation: requireNonBlank(request.operation, "Electron operation"),
    payload: request.payload,
  };
  return cloneJson<ApiRequest>(captured, "Electron API request");
}

function validateOpenSubscriptionRequest(
  value: unknown,
): ElectronBridgeOpenSubscriptionRequest {
  const request = requireRecord(value, "Electron subscription request");
  return {
    subscriptionId: requireNonBlank(
      request.subscriptionId,
      "Electron subscriptionId",
    ),
    request: validateApiRequest(request.request),
  };
}

function validateApiSubscription(value: unknown): asserts value is ApiSubscription {
  if (
    value === null ||
    typeof value !== "object" ||
    typeof (value as { next?: unknown }).next !== "function" ||
    typeof (value as { close?: unknown }).close !== "function"
  ) {
    throw new DesktopIpcFailure(
      "ELECTRON_IPC_PROTOCOL_ERROR",
      false,
      "Host API subscription is invalid",
    );
  }
}

function rewriteSubscriptionFrame(
  value: ApiEventFrame,
  subscriptionId: string,
): ApiEventFrame {
  const frame = requireRecord(value, "Host API Event frame");
  if (frame.protocolVersion !== API_PROTOCOL_VERSION) {
    throw new DesktopIpcFailure(
      "ELECTRON_IPC_PROTOCOL_ERROR",
      false,
      "Host API Event frame protocol version is incompatible",
    );
  }
  return cloneJson<ApiEventFrame>(
    {
      protocolVersion: API_PROTOCOL_VERSION,
      subscriptionId,
      event: frame.event,
    },
    "Host API Event frame",
  );
}

function bridgeSuccess<TValue>(value: TValue): ElectronBridgeResult<TValue> {
  return {
    ok: true,
    value: cloneJson<TValue>(value, "Electron IPC result"),
  };
}

function mapBridgeFailure(error: unknown): {
  readonly ok: false;
  readonly error: { readonly code: string; readonly retryable: boolean };
} {
  if (error instanceof DesktopIpcFailure || error instanceof ApiTransportError) {
    return {
      ok: false,
      error: { code: error.code, retryable: error.retryable },
    };
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return {
      ok: false,
      error: { code: "ELECTRON_REQUEST_CANCELLED", retryable: false },
    };
  }
  return {
    ok: false,
    error: { code: "ELECTRON_MAIN_FAILURE", retryable: true },
  };
}

function acknowledgement(): ElectronBridgeAcknowledgement {
  return { acknowledged: true };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new DesktopIpcFailure(
      "ELECTRON_IPC_PROTOCOL_ERROR",
      false,
      `${label} is invalid`,
    );
  }
  return value as Record<string, unknown>;
}

function requireNonBlank(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DesktopIpcFailure(
      "ELECTRON_IPC_PROTOCOL_ERROR",
      false,
      `${label} is invalid`,
    );
  }
  return value;
}

function validateSenderId(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new DesktopIpcFailure(
      "ELECTRON_IPC_UNAUTHORIZED",
      false,
      "Electron IPC sender is invalid",
    );
  }
  return value as number;
}

function cloneJson<TValue>(value: unknown, label: string): TValue {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new TypeError("JSON serialization returned undefined");
    }
    return JSON.parse(serialized) as TValue;
  } catch {
    throw new DesktopIpcFailure(
      "ELECTRON_IPC_PROTOCOL_ERROR",
      false,
      `${label} is not JSON serializable`,
    );
  }
}

function getOrCreateSenderMap<TValue>(
  source: Map<number, Map<string, TValue>>,
  senderId: number,
): Map<string, TValue> {
  const existing = source.get(senderId);
  if (existing !== undefined) return existing;
  const created = new Map<string, TValue>();
  source.set(senderId, created);
  return created;
}

function deleteEmptySenderMap<TValue>(
  source: Map<number, Map<string, TValue>>,
  senderId: number,
  values: Map<string, TValue>,
): void {
  if (values.size === 0) source.delete(senderId);
}
