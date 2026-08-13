/**
 * ToastStore
 *
 * 全局 toast 队列 store。ToastHost（shell/overlays）订阅渲染；
 * auto-dismiss 计时由宿主负责，store 只维护队列。
 */
import { ExternalStore } from "./ExternalStore.js";

export type ToastKind = "info" | "success" | "warn" | "danger";

export interface Toast {
  readonly id: string;
  readonly kind: ToastKind;
  readonly text: string;
  readonly createdAt: number;
}

export interface ToastSnapshot {
  readonly toasts: readonly Toast[];
}

let toastSequence = 0;

export class ToastStore extends ExternalStore<ToastSnapshot> {
  constructor() {
    super({ toasts: [] });
  }

  /** 追加一条 toast，返回其 id。 */
  push(toast: Omit<Toast, "id" | "createdAt">): string {
    const id = `toast-${++toastSequence}`;
    const createdAt = Date.now();
    this.setSnapshot({
      toasts: [...this.snapshot.toasts, { ...toast, id, createdAt }],
    });
    return id;
  }

  dismiss(id: string): void {
    this.setSnapshot({
      toasts: this.snapshot.toasts.filter((item) => item.id !== id),
    });
  }
}
