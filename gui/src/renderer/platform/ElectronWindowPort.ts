/**
 * createElectronWindowPort
 *
 * 把 preload bridge 的 window 子 API 适配为 DesktopWindowPort（spec 5.4）。
 * bridge.window 缺失时返回 undefined。
 */
import { ApiTransportError } from "@novel/core";
import type {
  DesktopWindowPort,
  ElectronBridgeResult,
  ElectronPreloadBridge,
  ElectronWindowBridge,
} from "../../shared/index.js";

export function createElectronWindowPort(
  bridge: ElectronPreloadBridge,
): DesktopWindowPort | undefined {
  const window = bridge.window;
  if (window === undefined) return undefined;
  return Object.freeze({
    minimize: async () => {
      unwrap(await window.minimize());
    },
    maximize: async () => {
      unwrap(await window.maximize());
    },
    close: async () => {
      unwrap(await window.close());
    },
    setAlwaysOnTop: async (alwaysOnTop: boolean) => {
      unwrap(await window.setAlwaysOnTop(alwaysOnTop));
    },
    setFullscreen: async (fullscreen: boolean) => {
      unwrap(await window.setFullscreen(fullscreen));
    },
  });
}

function unwrap<TValue>(result: ElectronBridgeResult<TValue>): TValue {
  if (result.ok) return result.value;
  throw new ApiTransportError(
    result.error.code,
    result.error.retryable,
    "Electron window operation failed",
  );
}

export type { ElectronWindowBridge };
