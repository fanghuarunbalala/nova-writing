/**
 * useExitPhase
 *
 * 条件渲染元素的退场动画相位（demo .closing 的 React 等价物）：
 * `open=false` 后先保留 DOM（exiting，挂退场动画类），duration 后再卸载；
 * 退出中重开自动取消（清定时器/清 exiting）。适用于非 radix 浮层
 * （radix Presence 自带 data-state 退出，无需此 hook）。
 *
 * 用法：const phase = useExitPhase(visible, 250);
 *       phase.mounted ? <div className={phase.exiting ? styles.leaving : undefined}>…</div> : null
 */
import { useEffect, useState } from "react";

export interface ExitPhase {
  /** 是否保留 DOM（open 或退场动画未播完）。 */
  readonly mounted: boolean;
  /** 正在播退场动画（挂 leaving 类；duration 后转 false 并卸载）。 */
  readonly exiting: boolean;
}

export function useExitPhase(open: boolean, durationMs: number): ExitPhase {
  const [mounted, setMounted] = useState(open);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setExiting(false);
      return;
    }
    if (!mounted) return;
    setExiting(true);
    const timer = setTimeout(() => {
      setMounted(false);
      setExiting(false);
    }, durationMs);
    return () => clearTimeout(timer);
    // mounted 只在 open 变 false 分支内读取（判断是否进入退场）；
    // 有意不进依赖：退出启动后自身 setState 引发的重渲染不得重启/清退场定时器
  }, [open, durationMs]);

  // open=true 时同步跟上（避免「上一帧卸载完、open 已 true 但 effect 未跑」闪空帧）
  if (open && !mounted) {
    return { mounted: true, exiting: false };
  }
  return { mounted, exiting };
}
