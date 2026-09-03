/**
 * 登录门跳过记忆：localStorage("novel.login.skip.v1")。
 * 用户点「暂不登录，本地模式使用」即记住——之后启动不再自动弹登录页
 * （欢迎页入口 / 设置 → Server 仍可进入，进入时清除本标记允许再次自动弹）。
 * 存储不可用（隐私模式等）时静默降级为每次启动重弹（对齐 onboardingStorage 模式）。
 */
const STORAGE_KEY = "novel.login.skip.v1";
const SKIPPED_VALUE = "skipped";

/** 是否曾跳过登录门（无记录 / 存储不可用 → false，启动弹登录页） */
export function hasSkippedLoginGate(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === SKIPPED_VALUE;
  } catch {
    return false;
  }
}

/** 记住「跳过登录门」（点「暂不登录，本地模式使用」时调用） */
export function markLoginGateSkipped(): void {
  try {
    localStorage.setItem(STORAGE_KEY, SKIPPED_VALUE);
  } catch {
    // 存储不可用：仅本次会话生效
  }
}

/** 清除跳过记忆（用户主动从欢迎页/设置重新进入登录页时调用，恢复自动弹） */
export function clearLoginGateSkip(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 存储不可用：忽略
  }
}
