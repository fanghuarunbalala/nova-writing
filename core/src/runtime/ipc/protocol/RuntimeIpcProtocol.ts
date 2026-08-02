/** Serializable provider-neutral frames shared by Runtime IPC transports. */
import type { JsonValue } from "../../../event/protocol/index.js";
import type { RuntimeIpcErrorSnapshot } from "./RuntimeIpcErrorSnapshot.js";

export const RUNTIME_IPC_PROTOCOL_FAMILY = "novel.runtime.ipc" as const;
export const RUNTIME_IPC_PROTOCOL_VERSION = 1 as const;
export const RUNTIME_IPC_MAX_FRAME_BYTES = 1024 * 1024;

export type RuntimeIpcProtocolVersion = typeof RUNTIME_IPC_PROTOCOL_VERSION;

export interface RuntimeIpcProtocolRange {
  readonly minimumVersion: number;
  readonly maximumVersion: number;
}

export const RUNTIME_IPC_SUPPORTED_PROTOCOL_RANGE: RuntimeIpcProtocolRange =
  Object.freeze({
    minimumVersion: RUNTIME_IPC_PROTOCOL_VERSION,
    maximumVersion: RUNTIME_IPC_PROTOCOL_VERSION,
  });

export const RUNTIME_IPC_FRAME_TYPE = {
  hello: "hello",
  welcome: "welcome",
  rejected: "rejected",
  request: "request",
  response: "response",
  notification: "notification",
} as const;

export type RuntimeIpcFrameType =
  (typeof RUNTIME_IPC_FRAME_TYPE)[keyof typeof RUNTIME_IPC_FRAME_TYPE];

export interface RuntimeIpcHelloFrame {
  readonly frameType: typeof RUNTIME_IPC_FRAME_TYPE.hello;
  readonly protocolFamily: typeof RUNTIME_IPC_PROTOCOL_FAMILY;
  readonly supportedProtocol: RuntimeIpcProtocolRange;
  readonly processNonce: string;
}

export interface RuntimeIpcWelcomeFrame {
  readonly frameType: typeof RUNTIME_IPC_FRAME_TYPE.welcome;
  readonly protocolVersion: RuntimeIpcProtocolVersion;
  readonly sessionId: string;
  readonly processNonce: string;
}

export const RUNTIME_IPC_REJECTION_REASON = {
  unsupportedVersion: "unsupported_version",
} as const;

export type RuntimeIpcRejectionReason =
  (typeof RUNTIME_IPC_REJECTION_REASON)[keyof typeof RUNTIME_IPC_REJECTION_REASON];

export interface RuntimeIpcRejectedFrame {
  readonly frameType: typeof RUNTIME_IPC_FRAME_TYPE.rejected;
  readonly protocolFamily: typeof RUNTIME_IPC_PROTOCOL_FAMILY;
  readonly reason: RuntimeIpcRejectionReason;
  readonly supportedProtocol: RuntimeIpcProtocolRange;
  readonly processNonce: string;
}

interface RuntimeIpcSessionFrame {
  readonly protocolVersion: RuntimeIpcProtocolVersion;
  readonly sessionId: string;
}

export interface RuntimeIpcRequestFrame<
  TMethod extends string = string,
  TPayload extends JsonValue = JsonValue,
> extends RuntimeIpcSessionFrame {
  readonly frameType: typeof RUNTIME_IPC_FRAME_TYPE.request;
  readonly requestId: string;
  readonly method: TMethod;
  readonly payload: TPayload;
}

export type RuntimeIpcResponseFrame<TData extends JsonValue = JsonValue> =
  | RuntimeIpcSuccessResponseFrame<TData>
  | RuntimeIpcFailureResponseFrame;

export interface RuntimeIpcSuccessResponseFrame<
  TData extends JsonValue = JsonValue,
> extends RuntimeIpcSessionFrame {
  readonly frameType: typeof RUNTIME_IPC_FRAME_TYPE.response;
  readonly requestId: string;
  readonly ok: true;
  readonly data: TData;
}

export interface RuntimeIpcFailureResponseFrame extends RuntimeIpcSessionFrame {
  readonly frameType: typeof RUNTIME_IPC_FRAME_TYPE.response;
  readonly requestId: string;
  readonly ok: false;
  readonly error: RuntimeIpcErrorSnapshot;
}

export interface RuntimeIpcNotificationFrame<
  TMethod extends string = string,
  TPayload extends JsonValue = JsonValue,
> extends RuntimeIpcSessionFrame {
  readonly frameType: typeof RUNTIME_IPC_FRAME_TYPE.notification;
  readonly notificationId: string;
  readonly method: TMethod;
  readonly payload: TPayload;
}

export type RuntimeIpcHandshakeFrame =
  | RuntimeIpcHelloFrame
  | RuntimeIpcWelcomeFrame
  | RuntimeIpcRejectedFrame;

export type RuntimeIpcFrame =
  | RuntimeIpcHandshakeFrame
  | RuntimeIpcRequestFrame
  | RuntimeIpcResponseFrame
  | RuntimeIpcNotificationFrame;
