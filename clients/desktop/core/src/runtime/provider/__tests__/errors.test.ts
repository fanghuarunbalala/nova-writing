import { describe, it, expect } from "vitest";
import {
  ProviderError,
  ProviderRequestError,
  ProviderAuthError,
  ProviderInsufficientFundsError,
  ProviderRateLimitedError,
  ProviderTimeoutError,
  ProviderNetworkError,
  ProviderServerError,
  ProviderAbortedError,
  ProviderUnknownError,
  toProviderError,
} from "../errors.js";

describe("toProviderError 分类（对接 SDK/HTTP 原生错误）", () => {
  it.each([
    // [HTTP 状态, 期望错误类, 期望 retryable]
    [400, ProviderRequestError, false],
    [401, ProviderAuthError, false],
    [402, ProviderInsufficientFundsError, false],
    [403, ProviderAuthError, false],
    [404, ProviderUnknownError, false],
    [408, ProviderTimeoutError, true],
    [422, ProviderRequestError, false],
    [429, ProviderRateLimitedError, true],
    [500, ProviderServerError, true],
    [529, ProviderServerError, true],
  ] as const)("HTTP %s → %s（retryable=%s）", (status, ErrorClass, retryable) => {
    const err = toProviderError(Object.assign(new Error("api error"), { status }));
    expect(err).toBeInstanceOf(ErrorClass);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.retryable).toBe(retryable);
  });

  it("AbortError（signal 取消）→ ProviderAbortedError，不可重试", () => {
    const err = toProviderError(Object.assign(new Error("aborted"), { name: "AbortError" }));
    expect(err).toBeInstanceOf(ProviderAbortedError);
    expect(err.retryable).toBe(false);
  });

  it("TimeoutError → ProviderTimeoutError，可重试", () => {
    const err = toProviderError(Object.assign(new Error("timeout"), { name: "TimeoutError" }));
    expect(err).toBeInstanceOf(ProviderTimeoutError);
    expect(err.retryable).toBe(true);
  });

  it("APIConnectionError（SDK 网络层）→ ProviderNetworkError，可重试", () => {
    const err = toProviderError(
      Object.assign(new Error("fetch failed"), { name: "APIConnectionError" }),
    );
    expect(err).toBeInstanceOf(ProviderNetworkError);
    expect(err.retryable).toBe(true);
  });

  it("TypeError（fetch 网络失败）→ ProviderNetworkError，可重试", () => {
    const err = toProviderError(new TypeError("fetch failed"));
    expect(err).toBeInstanceOf(ProviderNetworkError);
    expect(err.retryable).toBe(true);
  });

  it("已是 ProviderError 则原样返回", () => {
    const original = new ProviderRateLimitedError("rate limited");
    expect(toProviderError(original)).toBe(original);
  });

  it("携带来源 provider 名与状态码", () => {
    const err = toProviderError(Object.assign(new Error("x"), { status: 429 }), "anthropic");
    expect(err).toBeInstanceOf(ProviderRateLimitedError);
    expect(err.provider).toBe("anthropic");
    expect(err.status).toBe(429);
  });
});
