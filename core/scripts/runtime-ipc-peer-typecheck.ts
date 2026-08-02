/** Compile-time examples for the transport-neutral Runtime IPC Peer. */
import type {
  JsonValue,
  RuntimeIpcConnection,
  RuntimeIpcNotificationHandler,
  RuntimeIpcPeer,
  RuntimeIpcRequestHandler,
} from "../src/index.js";

declare const connection: RuntimeIpcConnection;
declare const peer: RuntimeIpcPeer;

const requestHandler: RuntimeIpcRequestHandler = {
  async handle(method, payload, context): Promise<JsonValue> {
    const aborted: boolean = context.signal.aborted;
    void method;
    void aborted;
    return payload;
  },
};

const notificationHandler: RuntimeIpcNotificationHandler = {
  async handle(method, payload): Promise<void> {
    void method;
    void payload;
  },
};

const result: Promise<{ accepted: boolean }> = peer.request(
  "runtime.start",
  { conversationId: "conversation-1" },
);

void connection;
void requestHandler;
void notificationHandler;
void result;
