/**
 * createElectronUpdaterPort
 *
 * 把 preload bridge 的 updater 子 API 适配为 DesktopUpdaterPort（spec 5.4）。
 * bridge.updater 缺失时返回 undefined。
 */
import { ApiTransportError } from "@novel/core";
import type {
  DesktopUpdaterPort,
  ElectronBridgeResult,
  ElectronPreloadBridge,
  ElectronUpdaterBridge,
} from "../../shared/index.js";

export function createElectronUpdaterPort(
  bridge: ElectronPreloadBridge,
): DesktopUpdaterPort | undefined {
  const updater = bridge.updater;
  if (updater === undefined) return undefined;
  return Object.freeze({
    checkForUpdates: async () => unwrap(await updater.checkForUpdates()),
    downloadUpdate: async () => {
      unwrap(await updater.downloadUpdate());
    },
    quitAndInstall: async () => {
      unwrap(await updater.quitAndInstall());
    },
  });
}

function unwrap<TValue>(result: ElectronBridgeResult<TValue>): TValue {
  if (result.ok) return result.value;
  throw new ApiTransportError(
    result.error.code,
    result.error.retryable,
    "Electron updater operation failed",
  );
}

export type { ElectronUpdaterBridge };
