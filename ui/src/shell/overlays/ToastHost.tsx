/**
 * ToastHost
 *
 * 全局 toast 堆叠（右下角）；auto-dismiss 4s。
 */
import { useEffect } from "react";
import { X } from "lucide-react";
import { useExternalStore } from "../../shared/state/useExternalStore.js";
import { Icon } from "../../shared/primitives/Icon.js";
import type { ToastStore } from "../../shared/state/ToastStore.js";
import styles from "./ToastHost.module.css";

const AUTO_DISMISS_MS = 4000;

export interface ToastHostProps {
  readonly store: ToastStore;
}

export function ToastHost({ store }: ToastHostProps) {
  const { toasts } = useExternalStore(store);
  useEffect(() => {
    const timers = toasts.map((toast) =>
      setTimeout(() => store.dismiss(toast.id), AUTO_DISMISS_MS),
    );
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [store, toasts]);
  if (toasts.length === 0) return null;
  return (
    <div className={styles.host} role="region" aria-label="通知">
      {toasts.map((toast) => (
        <div key={toast.id} className={[styles.toast, styles[toast.kind]].filter(Boolean).join(" ")}>
          <span className={styles.text}>{toast.text}</span>
          <button
            type="button"
            className={styles.dismiss}
            aria-label="关闭通知"
            onClick={() => store.dismiss(toast.id)}
          >
            <Icon icon={X} size="xs" />
          </button>
        </div>
      ))}
    </div>
  );
}
