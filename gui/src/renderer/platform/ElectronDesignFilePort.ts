/**
 * createElectronDesignFilePort
 *
 * 把 preload bridge 的 design 子 API 适配为 DesktopDesignFilePort。bridge.design
 * 缺失时返回 undefined；unwrap 把 ElectronBridgeResult 错误转为 ApiTransportError。
 */
import { ApiTransportError } from "@novel/core";
import type {
  DesktopDesignFilePort,
  ElectronBridgeResult,
  ElectronDesignBridge,
  ElectronDesignFileSnapshot,
  ElectronPreloadBridge,
} from "../../shared/index.js";

export function createElectronDesignFilePort(
  bridge: ElectronPreloadBridge,
): DesktopDesignFilePort | undefined {
  const design = bridge.design;
  if (design === undefined) return undefined;
  return Object.freeze({
    read: async (conversationId: string) => {
      const snapshot = unwrap<ElectronDesignFileSnapshot>(
        await design.read(conversationId),
      );
      return snapshot.content;
    },
    write: async (conversationId: string, content: string) => {
      unwrap(await design.write(conversationId, content));
    },
  });
}

function unwrap<TValue>(result: ElectronBridgeResult<TValue>): TValue {
  if (result.ok) return result.value;
  throw new ApiTransportError(
    result.error.code,
    result.error.retryable,
    "Electron design file operation failed",
  );
}

export type { ElectronDesignBridge };
