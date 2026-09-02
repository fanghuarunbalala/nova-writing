/**
 * approvalChangeBus
 *
 * 审批队列变化通知注册表（renderer 内模块级单例）：
 * main 经「ui-rpc」通道直接 rpc 调用 renderer 暴露的 onApprovalsChanged → emit()；
 * ApplicationShell 注册 listener 触发 ApprovalStore.refresh()（拉取为准，推送仅作触发）。
 */
const listeners = new Set<() => void>();

/** 触发审批队列变化通知（由 renderer 暴露的 onApprovalsChanged 调用） */
export function emitApprovalsChanged(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // 通知失败不影响其他监听者
    }
  }
}

/**
 * 注册审批队列变化监听（返回取消函数）
 * @param listener 变化回调
 */
export function onApprovalsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
