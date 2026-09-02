/**
 * askingChangeBus
 *
 * 提问队列变化通知注册表（renderer 内模块级单例）：
 * main 经「ui-rpc」通道直接 rpc 调用 renderer 暴露的 onAskingsChanged → emit()；
 * ApplicationShell 注册 listener 触发 AskingStore.refresh()（拉取为准，推送仅作触发）。
 */
const listeners = new Set<() => void>();

/** 触发提问队列变化通知（由 renderer 暴露的 onAskingsChanged 调用） */
export function emitAskingsChanged(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // 通知失败不影响其他监听者
    }
  }
}

/**
 * 注册提问队列变化监听（返回取消函数）
 * @param listener 变化回调
 */
export function onAskingsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
