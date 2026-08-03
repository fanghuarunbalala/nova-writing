/** Compile-only proof for the browser HTTP request protocol boundary. */
import type { ApiResponse } from "@novel/core";
import {
  HttpApiRequestClient,
  type WebRequestHeadersProvider,
} from "../src/index.js";

const headersProvider: WebRequestHeadersProvider = {
  getHeaders: async () => ({ authorization: "Bearer token" }),
};
const client = new HttpApiRequestClient({
  origin: "https://novel.example",
  headersProvider,
});
const response: Promise<ApiResponse<{ readonly accepted: true }>> = client.request({
  protocolVersion: 1,
  requestId: "request-typecheck",
  operation: "test.request",
  payload: null,
});

void response;
