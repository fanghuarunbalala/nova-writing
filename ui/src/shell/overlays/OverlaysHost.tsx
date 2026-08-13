/**
 * OverlaysHost
 *
 * 全局浮层容器：设置/Workspace 弹窗（children 槽位，Phase 4 接入
 * 既有 dialogs）+ ToastHost。
 */
import type { ReactNode } from "react";
import type { ToastStore } from "../../shared/state/ToastStore.js";
import { ToastHost } from "./ToastHost.js";

export interface OverlaysHostProps {
  readonly toastStore: ToastStore;
  readonly children?: ReactNode;
}

export function OverlaysHost({ toastStore, children }: OverlaysHostProps) {
  return (
    <>
      {children}
      <ToastHost store={toastStore} />
    </>
  );
}
