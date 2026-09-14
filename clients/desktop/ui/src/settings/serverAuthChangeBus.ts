/**
 * serverAuthChangeBus
 *
 * server 认证状态变更通知（renderer 内模块级单例）：
 * main 的 ServerAuthSession.onStatusChange → webContents.send("server-auth-changed")
 * → preload 桥 onServerAuthChange → renderer 调用 emitServerAuthStateChanged(state)
 * → NovelApp 订阅更新 serverAuthState（登录门/欢迎页入口卡随之反应）。
 * 推送之前 UI 只有启动时一次性拉取的乐观快照，offline/needRelogin 翻转后 UI 无感知
 * （僵尸登录态根因之一，客户端固定server PRD v0.1 修正）。
 */
import type { ServerAuthState } from "@novel/core";

const listeners = new Set<(state: ServerAuthState) => void>();

/** 触发认证状态变更通知（由 renderer 的 preload 桥订阅转发调用） */
export function emitServerAuthStateChanged(state: ServerAuthState): void {
  for (const listener of [...listeners]) {
    try {
      listener(state);
    } catch {
      // 通知失败不影响其他监听者
    }
  }
}

/** 注册认证状态监听（返回取消函数） */
export function onServerAuthStateChanged(listener: (state: ServerAuthState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
