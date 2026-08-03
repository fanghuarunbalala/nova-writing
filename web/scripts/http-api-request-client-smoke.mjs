import assert from "node:assert/strict";
import {
  ApiTransportDisconnectedError,
  ApiTransportError,
} from "../../core/dist/index.js";
import {
  HttpApiRequestClient,
  WEB_API_REQUEST_PATH,
} from "../dist/index.js";

await assertSuccessAndRedaction();
await assertCancellationAndDisconnect();
await assertHttpAndProtocolFailures();
await assertConfigurationValidation();

console.log("http api request client smoke passed");

async function assertSuccessAndRedaction() {
  const calls = [];
  const logs = [];
  const privateToken = "private-web-access-token";
  const privateText = "private-novel-request-text";
  const client = new HttpApiRequestClient({
    origin: "https://novel.example",
    fetch: async (input, init) => {
      calls.push({ input, init });
      return jsonResponse({
        protocolVersion: 1,
        requestId: "request-success",
        ok: true,
        data: { accepted: true },
      });
    },
    headersProvider: {
      getHeaders: async () => ({ authorization: `Bearer ${privateToken}` }),
    },
    logger: createCollectingLogger(logs),
  });
  const response = await client.request(
    createRequest("request-success", { text: privateText }),
  );

  assert.equal(client.endpoint, `https://novel.example${WEB_API_REQUEST_PATH}`);
  assert.equal(response.ok, true);
  assert.equal(response.data.accepted, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, client.endpoint);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.credentials, "include");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[0].init.referrerPolicy, "no-referrer");
  assert.equal(calls[0].init.headers.get("authorization"), `Bearer ${privateToken}`);
  assert.deepEqual(JSON.parse(calls[0].init.body),
    createRequest("request-success", { text: privateText }));
  const serializedLogs = JSON.stringify(logs);
  assert.equal(serializedLogs.includes(privateToken), false);
  assert.equal(serializedLogs.includes(privateText), false);
}

async function assertCancellationAndDisconnect() {
  const controller = new AbortController();
  const client = new HttpApiRequestClient({
    origin: "https://novel.example",
    fetch: async (_input, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener(
          "abort",
          () => reject(init.signal.reason),
          { once: true },
        );
      }),
  });
  const pending = client.request(createRequest("request-abort"), {
    signal: controller.signal,
  });
  controller.abort(new DOMException("cancelled", "AbortError"));
  await assert.rejects(pending, (error) => error?.name === "AbortError");

  const privateError = "private-fetch-failure";
  const disconnected = new HttpApiRequestClient({
    origin: "https://novel.example",
    fetch: async () => {
      throw new Error(privateError);
    },
  });
  await assert.rejects(
    disconnected.request(createRequest("request-disconnect")),
    (error) =>
      error instanceof ApiTransportDisconnectedError &&
      !error.message.includes(privateError),
  );
}

async function assertHttpAndProtocolFailures() {
  for (const [status, retryable] of [[400, false], [429, true], [503, true]]) {
    const client = clientWithResponse(new Response("private server body", { status }));
    await assert.rejects(
      client.request(createRequest(`request-status-${status}`)),
      (error) =>
        error instanceof ApiTransportError &&
        error.code === "WEB_HTTP_STATUS_ERROR" &&
        error.retryable === retryable &&
        !error.message.includes("private server body"),
    );
  }

  const wrongType = clientWithResponse(
    new Response("{}", { status: 200, headers: { "content-type": "text/plain" } }),
  );
  await assertProtocolError(wrongType, "request-content-type");

  const malformed = clientWithResponse(
    new Response("{invalid", {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  await assertProtocolError(malformed, "request-malformed");

  const oversized = new HttpApiRequestClient({
    origin: "https://novel.example",
    maxResponseBytes: 8,
    fetch: async () => jsonResponse({ private: "response-too-large" }),
  });
  await assert.rejects(
    oversized.request(createRequest("request-oversized")),
    (error) =>
      error instanceof ApiTransportError &&
      error.code === "WEB_HTTP_RESPONSE_TOO_LARGE",
  );
}

async function assertConfigurationValidation() {
  for (const origin of [
    "file:///application",
    "https://user@novel.example",
    "https://novel.example/path",
    "https://novel.example?token=private",
  ]) {
    assert.throws(
      () => new HttpApiRequestClient({ origin, fetch: async () => jsonResponse({}) }),
      (error) =>
        error instanceof ApiTransportError &&
        error.code === "WEB_HTTP_ORIGIN_INVALID",
    );
  }

  const invalidHeader = new HttpApiRequestClient({
    origin: "https://novel.example",
    fetch: async () => jsonResponse({}),
    headersProvider: { getHeaders: () => ({ "bad header": "value" }) },
  });
  await assert.rejects(
    invalidHeader.request(createRequest("request-header")),
    (error) =>
      error instanceof ApiTransportError && error.code === "WEB_HTTP_HEADER_INVALID",
  );

  const failedHeaders = new HttpApiRequestClient({
    origin: "https://novel.example",
    fetch: async () => jsonResponse({}),
    headersProvider: {
      getHeaders: () => {
        throw new Error("private auth failure");
      },
    },
  });
  await assert.rejects(
    failedHeaders.request(createRequest("request-auth")),
    (error) =>
      error instanceof ApiTransportError &&
      error.code === "WEB_REQUEST_HEADERS_FAILED" &&
      !error.message.includes("private auth failure"),
  );
}

async function assertProtocolError(client, requestId) {
  await assert.rejects(
    client.request(createRequest(requestId)),
    (error) =>
      error instanceof ApiTransportError &&
      error.code === "WEB_HTTP_PROTOCOL_ERROR",
  );
}

function clientWithResponse(response) {
  return new HttpApiRequestClient({
    origin: "https://novel.example",
    fetch: async () => response,
  });
}

function createRequest(requestId, payload = null) {
  return {
    protocolVersion: 1,
    requestId,
    operation: "test.request",
    payload,
  };
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function createCollectingLogger(entries) {
  return {
    debug: (event, fields) => entries.push({ level: "debug", event, fields }),
    info: (event, fields) => entries.push({ level: "info", event, fields }),
    warn: (event, fields) => entries.push({ level: "warn", event, fields }),
    error: (event, fields) => entries.push({ level: "error", event, fields }),
    child() {
      return this;
    },
  };
}
