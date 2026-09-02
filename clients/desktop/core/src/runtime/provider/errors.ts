/** Provider 错误分类（toProviderError 内部映射用，不暴露到错误实例） */
export type ProviderErrorCode =
  /** 请求参数/格式错误（HTTP 400/422） */
  | "request-error"
  /** 认证失败（HTTP 401/403，API key 无效） */
  | "auth-error"
  /** 费用不足（HTTP 402） */
  | "insufficient-funds"
  /** 限流（HTTP 429） */
  | "rate-limit"
  /** 网络超时（HTTP 408/504） */
  | "timeout"
  /** 网络层失败（连不上，fetch 都失败） */
  | "network-error"
  /** 服务端错误（HTTP 5xx） */
  | "server-error"
  /** 被取消（signal.abort） */
  | "aborted"
  /** 兜底：无法分类 */
  | "unknown";

/** 具体错误类构造签名 */
type ProviderErrorConstructor = new (
  message: string,
  options?: { status?: number; provider?: string; cause?: unknown },
) => ProviderError;

/** 从 HTTP 状态码推断错误分类 */
function codeFromStatus(status: number): ProviderErrorCode {
  if (status === 400 || status === 422) return "request-error";
  if (status === 401 || status === 403) return "auth-error";
  if (status === 402) return "insufficient-funds";
  if (status === 429) return "rate-limit";
  if (status === 408) return "timeout";
  if (status >= 500) return "server-error";
  return "unknown";
}

/** 状态码 → 具体错误类（toProviderError 分发用） */
function errorClassFromStatus(status: number): ProviderErrorConstructor {
  switch (codeFromStatus(status)) {
    case "request-error":
      return ProviderRequestError;
    case "auth-error":
      return ProviderAuthError;
    case "insufficient-funds":
      return ProviderInsufficientFundsError;
    case "rate-limit":
      return ProviderRateLimitedError;
    case "timeout":
      return ProviderTimeoutError;
    case "server-error":
      return ProviderServerError;
    default:
      return ProviderUnknownError;
  }
}

/** provider 错误基类（抽象）：name 即具体类名，retryable 由子类固化 */
export abstract class ProviderError extends Error {
  /** 是否可重试（限流/网络/超时/服务端为 true，其余 false） */
  abstract readonly retryable: boolean;
  /** HTTP 状态码（若有） */
  readonly status?: number;
  /** 来源 provider 名（如 "anthropic"） */
  readonly provider?: string;

  /**
   * 构造 ProviderError
   * @param message 人类可读信息（不含密钥等敏感内容）
   * @param options 附加信息（status / provider / cause）
   */
  constructor(message: string, options?: { status?: number; provider?: string; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = new.target.name;
    this.status = options?.status;
    this.provider = options?.provider;
  }
}

/** 请求参数/格式错误（HTTP 400/422） */
export class ProviderRequestError extends ProviderError {
  readonly retryable = false;
}

/** 认证失败（HTTP 401/403，API key 无效） */
export class ProviderAuthError extends ProviderError {
  readonly retryable = false;
}

/** 费用不足（HTTP 402） */
export class ProviderInsufficientFundsError extends ProviderError {
  readonly retryable = false;
}

/** 限流（HTTP 429） */
export class ProviderRateLimitedError extends ProviderError {
  readonly retryable = true;
}

/** 请求超时（HTTP 408/504 或连接超时） */
export class ProviderTimeoutError extends ProviderError {
  readonly retryable = true;
}

/** 网络层失败（连不上，fetch 都失败） */
export class ProviderNetworkError extends ProviderError {
  readonly retryable = true;
}

/** 服务端错误（HTTP 5xx） */
export class ProviderServerError extends ProviderError {
  readonly retryable = true;
}

/** 请求被取消（signal.abort） */
export class ProviderAbortedError extends ProviderError {
  readonly retryable = false;
}

/** 兜底：无法分类 */
export class ProviderUnknownError extends ProviderError {
  readonly retryable = false;
}

/**
 * 判断是否为上下文超窗类错误（HTTP 400 + 超窗特征文案；压缩保险丝用）。
 * 覆盖主流厂商报错："prompt is too long" / "maximum context length is N tokens"
 * / "context window" / "token limit" 等；不含裸 "token"（避免误吞参数校验类 400）
 * @param err 待判断错误（provider 标准化后）
 * @returns 是否为上下文超窗错误
 */
export function isContextLengthError(err: unknown): boolean {
  if (!(err instanceof ProviderRequestError)) return false;
  return /too long|context length|context window|maximum context|token limit|exceeds?.{0,20}token/i.test(
    err.message,
  );
}

/**
 * 将原始错误封装为具体 ProviderError（SDK 原始错误 → 对应错误类，向上抛出）
 * @param raw 原始错误（SDK 错误对象 / HTTP 状态 / AbortError 等）
 * @param provider 来源 provider 名
 * @returns 标准化后的具体 ProviderError
 */
export function toProviderError(raw: unknown, provider?: string): ProviderError {
  // 已是标准化错误则原样返回
  if (raw instanceof ProviderError) {
    return raw;
  }
  const status = (raw as { status?: number } | null)?.status;
  const err = raw instanceof Error ? raw : new Error(String(raw));
  // SDK 错误类默认 name 为 "Error"（不设 this.name），需回退到 constructor.name 识别
  const errorName = err.name !== "Error" ? err.name : (err.constructor?.name ?? err.name);

  // 取消 / 超时（AbortSignal / AbortController 抛出的 DOMException，及 SDK 连接超时）
  if (errorName === "AbortError") {
    return new ProviderAbortedError("请求已被取消", { provider, cause: raw });
  }
  if (errorName === "TimeoutError" || errorName === "APIConnectionTimeoutError") {
    return new ProviderTimeoutError("请求超时", { status, provider, cause: raw });
  }
  // SDK 网络层失败（如 @anthropic-ai/sdk 的 APIConnectionError，status 为 undefined）
  if (errorName === "APIConnectionError") {
    return new ProviderNetworkError(`网络错误：${err.message}`, { provider, cause: raw });
  }
  // 带 HTTP 状态码的 SDK 错误 → 按状态码分发到具体错误类
  if (typeof status === "number") {
    const ErrorClass = errorClassFromStatus(status);
    return new ErrorClass(err.message, { status, provider, cause: raw });
  }
  // fetch 网络层失败（TypeError: fetch failed / 连接拒绝）
  if (err instanceof TypeError) {
    return new ProviderNetworkError(`网络错误：${err.message}`, { provider, cause: raw });
  }
  // 兜底
  return new ProviderUnknownError(err.message, { provider, cause: raw });
}
