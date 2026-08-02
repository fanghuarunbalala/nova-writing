/** Compile-time examples for the provider-neutral Runtime IPC protocol. */
import type {
  JsonValue,
  RuntimeIpcFrame,
  RuntimeIpcNotificationFrame,
  RuntimeIpcRequestFrame,
  RuntimeIpcResponseFrame,
} from "../src/index.js";

declare const frame: RuntimeIpcFrame;
declare const response: RuntimeIpcResponseFrame;

if (frame.frameType === "request") {
  const method: string = frame.method;
  const payload: JsonValue = frame.payload;
  void method;
  void payload;
}

if (response.ok) {
  const data: JsonValue = response.data;
  void data;
} else {
  const retryable: boolean = response.error.retryable;
  void retryable;
}

const request: RuntimeIpcRequestFrame<"runtime.start", { conversationId: string }> = {
  frameType: "request",
  protocolVersion: 1,
  sessionId: "session-1",
  requestId: "request-1",
  method: "runtime.start",
  payload: { conversationId: "conversation-1" },
};

const notification: RuntimeIpcNotificationFrame<"runtime.heartbeat", null> = {
  frameType: "notification",
  protocolVersion: 1,
  sessionId: "session-1",
  notificationId: "notification-1",
  method: "runtime.heartbeat",
  payload: null,
};

void request;
void notification;
