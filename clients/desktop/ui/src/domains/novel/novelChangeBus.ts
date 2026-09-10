/**
 * novelChangeBus
 *
 * novel 数据变更通知注册表（renderer 内模块级单例）：
 * main 订阅 ZeroMQ novel.changed → 直接 rpc 调用 renderer 暴露的 onNovelChanged → emit(entity)；
 * ApplicationShell 按实体类型调对应 store.invalidate()（拉取为准，推送仅触发）。
 */
const listeners = new Set<(entity: string) => void>();

/**
 * 触发 novel 数据变更通知（由 renderer 暴露的 onNovelChanged 调用）
 * @param entity 变更实体类型（outline/character/location/paragraph/publication）
 */
export function emitNovelChanged(entity: string): void {
  // 事件链断点可观测性：main 已转发但 renderer 侧无人订阅（ApplicationShell 未挂载/订阅断开）时告警
  if (listeners.size === 0) {
    console.warn(`[novelChangeBus] novel.changed(${entity}) 无监听者——ApplicationShell 未订阅，本次变更不会即时刷新`);
  }
  for (const listener of [...listeners]) {
    try {
      listener(entity);
    } catch {
      // 通知失败不影响其他监听者
    }
  }
}

/**
 * 注册 novel 变更监听（返回取消函数）
 * @param listener 变更回调（实体类型）
 */
export function onNovelChanged(listener: (entity: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
