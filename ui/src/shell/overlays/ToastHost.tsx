/**
 * ToastHost
 *
 * 全局 toast 堆叠（右下角）：图标化卡片 + 退场动画 + 倒计时条（hover 暂停）；
 * auto-dismiss 4s，最多同屏 4 条（超出挤掉最旧）。
 */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Info, OctagonX, TriangleAlert, X } from "lucide-react";
import { useExternalStore } from "../../shared/state/useExternalStore.js";
import { Icon } from "../../shared/primitives/Icon.js";
import type { ToastKind, ToastStore } from "../../shared/state/ToastStore.js";
import styles from "./ToastHost.module.css";

const AUTO_DISMISS_MS = 4000;

/** 同屏上限（超出挤掉最旧） */
const MAX_VISIBLE = 4;

/** 退场动画时长（ms；与 --duration-fast 对应） */
const EXIT_MS = 180;

const KIND_ICON: Record<ToastKind, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warn: TriangleAlert,
  danger: OctagonX,
};

export interface ToastHostProps {
  readonly store: ToastStore;
}

export function ToastHost({ store }: ToastHostProps) {
  const { toasts } = useExternalStore(store);
  // leaving = 退场动画播放中的本地标记（EXIT_MS 后从 store 真移除）
  const [leavingIds, setLeavingIds] = useState<ReadonlySet<string>>(() => new Set());

  const dismiss = useCallback(
    (id: string) => {
      setLeavingIds((prev) => {
        if (prev.has(id)) return prev;
        setTimeout(() => store.dismiss(id), EXIT_MS);
        return new Set([...prev, id]);
      });
    },
    [store],
  );

  // 队列变化：挤掉超限最旧 + 清理已移除条目的 leaving 残留
  useEffect(() => {
    const alive = new Set(toasts.map((t) => t.id));
    setLeavingIds((prev) => {
      const next = new Set([...prev].filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
    const overflow = toasts.slice(0, Math.max(0, toasts.length - MAX_VISIBLE));
    for (const drop of overflow) store.dismiss(drop.id);
  }, [toasts, store]);

  // 自动消失计时（leaving 中的条目不计时——退场动画即最终阶段）
  useEffect(() => {
    const timers = toasts
      .filter((toast) => !leavingIds.has(toast.id))
      .map((toast) => setTimeout(() => dismiss(toast.id), AUTO_DISMISS_MS));
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [toasts, leavingIds, dismiss]);

  const visible = toasts.slice(0, MAX_VISIBLE);
  if (visible.length === 0) return null;
  return (
    <div className={styles.host} role="region" aria-label="通知">
      {visible.map((toast) => {
        const Glyph = KIND_ICON[toast.kind];
        return (
          <div
            key={toast.id}
            className={styles.toast}
            data-kind={toast.kind}
            data-leaving={leavingIds.has(toast.id) ? "true" : "false"}
          >
            <span className={styles.iconWrap} data-kind={toast.kind}>
              <Icon icon={Glyph} size="sm" />
            </span>
            <span className={styles.text}>{toast.text}</span>
            <button
              type="button"
              className={styles.dismiss}
              aria-label="关闭通知"
              onClick={() => dismiss(toast.id)}
            >
              <Icon icon={X} size="xs" />
            </button>
            <span
              className={styles.timer}
              style={{ animationDuration: `${AUTO_DISMISS_MS}ms` } as React.CSSProperties}
            />
          </div>
        );
      })}
    </div>
  );
}
