/** Provider 错误分类 */
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

/** 错误分类是否可重试（限流/网络/超时/服务端可重试；请求/认证/费用/取消不可） */
function isRetryable(code: ProviderErrorCode): boolean {
  switch (code) {
    case "rate-limit":
    case "network-error":
    case "timeout":
    case "server-error":
      return true;
    default:
      return false;
  }
}

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

/** 标准化后的 provider 错误（适配器在边界封装原始 SDK 错误后向上抛出） */
export class ProviderError extends Error {
  /** 错误分类 */
  readonly code: ProviderErrorCode;
  /** 是否可重试 */
  readonly retryable: boolean;
  /** HTTP 状态码（若有） */
  readonly status?: number;
  /** 来源 provider 名（如 "anthropic"） */
  readonly provider?: string;

  /**
   * 构造 ProviderError
   * @param code 错误分类
   * @param message 人类可读信息（不含密钥等敏感内容）
   * @param options 附加信息（status / provider / cause）
   */
  constructor(
    code: ProviderErrorCode,
    message: string,
    options?: { status?: number; provider?: string; cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = "ProviderError";
    this.code = code;
    this.retryable = isRetryable(code);
    this.status = options?.status;
    this.provider = options?.provider;
  }
}

/**
 * 将原始错误封装为标准化 ProviderError（SDK 原始错误 → 统一分类，向上抛出）
 * @param raw 原始错误（SDK 错误对象 / HTTP 状态 / AbortError 等）
 * @param provider 来源 provider 名
 * @returns 标准化 ProviderError
 */
export function toProviderError(raw: unknown, provider?: string): ProviderError {
  // 已是标准化错误则原样返回
  if (raw instanceof ProviderError) {
    return raw;
  }
  const status = (raw as { status?: number } | null)?.status;
  const err = raw instanceof Error ? raw : new Error(String(raw));

  // 取消 / 超时（AbortSignal / AbortController 抛出的 DOMException）
  if (err.name === "AbortError") {
    return new ProviderError("aborted", "请求已被取消", { provider, cause: raw });
  }
  if (err.name === "TimeoutError") {
    return new ProviderError("timeout", "请求超时", { status, provider, cause: raw });
  }
  // 带 HTTP 状态码的 SDK 错误 → 按状态码分类
  if (typeof status === "number") {
    return new ProviderError(codeFromStatus(status), err.message, { status, provider, cause: raw });
  }
  // fetch 网络层失败（TypeError: fetch failed / 连接拒绝）
  if (err instanceof TypeError) {
    return new ProviderError("network-error", `网络错误：${err.message}`, { provider, cause: raw });
  }
  // 兜底
  return new ProviderError("unknown", err.message, { provider, cause: raw });
}
