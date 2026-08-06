/**
 * createElectronSystemTrayPort
 *
 * 把 preload bridge 的 tray 子 API 适配为 DesktopSystemTrayPort（spec 5.4）。
 * bridge.tray 缺失时返回 undefined。
 */
import { ApiTransportError } from "@novel/core";
import type {
  DesktopSystemTrayPort,
  DesktopTrayMenuItem,
  DesktopTrayNotification,
  ElectronBridgeResult,
  ElectronPreloadBridge,
  ElectronSystemTrayBridge,
} from "../../shared/index.js";

export function createElectronSystemTrayPort(
  bridge: ElectronPreloadBridge,
): DesktopSystemTrayPort | undefined {
  const tray = bridge.tray;
  if (tray === undefined) return undefined;
  return Object.freeze({
    setTrayIcon: async (iconPath: string) => {
      unwrap(await tray.setTrayIcon(iconPath));
    },
    setTrayMenu: async (items: readonly DesktopTrayMenuItem[]) => {
      unwrap(await tray.setTrayMenu(items));
    },
    showTrayNotification: async (notification: DesktopTrayNotification) => {
      unwrap(await tray.showTrayNotification(notification));
    },
  });
}

function unwrap<TValue>(result: ElectronBridgeResult<TValue>): TValue {
  if (result.ok) return result.value;
  throw new ApiTransportError(
    result.error.code,
    result.error.retryable,
    "Electron system tray operation failed",
  );
}

export type { ElectronSystemTrayBridge };
