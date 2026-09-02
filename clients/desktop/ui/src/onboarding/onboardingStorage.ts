/**
 * 新手引导首启标记：localStorage("novel.onboarding.v1")。
 * 完成 / 跳过均写入（之后仅可经顶栏帮助图标重开）；
 * 存储不可用（隐私模式等）时静默降级为每次启动重弹（对齐 ThemeProvider 模式）。
 */
const STORAGE_KEY = "novel.onboarding.v1";
const DONE_VALUE = "done";

/** 是否已完成引导（无记录 / 存储不可用 → false，首启弹向导） */
export function hasCompletedOnboarding(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === DONE_VALUE;
  } catch {
    return false;
  }
}

/** 写入完成标记（完成 / 跳过 / 关闭向导均调用） */
export function completeOnboarding(): void {
  try {
    localStorage.setItem(STORAGE_KEY, DONE_VALUE);
  } catch {
    // 存储不可用：仅本次会话生效
  }
}
