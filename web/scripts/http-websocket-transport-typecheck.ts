/** Compile-only proof that the composed browser adapter satisfies ApiTransport. */
import type { ApiTransport } from "@novel/core";
import {
  HttpWebSocketApiTransport,
  type BrowserWebSocketFactory,
} from "../src/index.js";

declare const createSocket: BrowserWebSocketFactory;
const transport: ApiTransport = new HttpWebSocketApiTransport({
  origin: "https://novel.example",
  fetch: async () =>
    new Response(
      JSON.stringify({ protocolVersion: 1, requestId: "request", ok: true, data: null }),
      { headers: { "content-type": "application/json" } },
    ),
  createSocket,
});

void transport.request({
  protocolVersion: 1,
  requestId: "request-typecheck",
  operation: "test.request",
  payload: null,
});
