/** JSON Wire messages for one browser WebSocket Event subscription. */
import type { ApiEventFrame, ApiRequest } from "@novel/core";

export const WEB_API_SUBSCRIPTION_PATH = "/api/v1/subscriptions" as const;
export const WEB_API_WEBSOCKET_PROTOCOL = "novel.api.v1" as const;

export interface WebSocketOpenSubscriptionMessage {
  readonly protocolVersion: 1;
  readonly kind: "open";
  readonly subscriptionId: string;
  readonly request: ApiRequest;
}

export interface WebSocketCloseSubscriptionMessage {
  readonly protocolVersion: 1;
  readonly kind: "close";
  readonly subscriptionId: string;
}

export type WebSocketClientMessage =
  | WebSocketOpenSubscriptionMessage
  | WebSocketCloseSubscriptionMessage;

export type WebSocketServerMessage =
  | {
      readonly protocolVersion: 1;
      readonly kind: "opened";
      readonly subscriptionId: string;
    }
  | {
      readonly protocolVersion: 1;
      readonly kind: "event";
      readonly subscriptionId: string;
      readonly frame: ApiEventFrame;
    }
  | {
      readonly protocolVersion: 1;
      readonly kind: "done";
      readonly subscriptionId: string;
    }
  | {
      readonly protocolVersion: 1;
      readonly kind: "error";
      readonly subscriptionId: string;
      readonly error: {
        readonly code: string;
        readonly retryable: boolean;
      };
    };
