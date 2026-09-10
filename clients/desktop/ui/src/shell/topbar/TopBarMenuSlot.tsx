/**
 * TopBarMenuSlot
 *
 * 接收 extensions.titleBar 注入的菜单项（桌面专属，Phase 4 接入）。
 */
import type { ReactNode } from "react";

export interface TopBarMenuSlotProps {
  readonly children?: ReactNode;
}

export function TopBarMenuSlot({ children }: TopBarMenuSlotProps) {
  return <>{children}</>;
}
