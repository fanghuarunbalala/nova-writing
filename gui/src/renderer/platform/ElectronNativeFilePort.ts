/**
 * createElectronNativeFilePort
 *
 * 把 preload bridge 的 files 子 API 适配为 DesktopNativeFilePort（spec 5.4）。
 * bridge.files 缺失时返回 undefined，消费者做 nullish 检查。
 *
 * unwrap 把 ElectronBridgeResult 错误转为 ApiTransportError，保持与
 * ElectronWorkspaceController 一致的错误模型。
 */
import { ApiTransportError } from "@novel/core";
import type { FrontendFileReference } from "@novel/ui";
import type {
  DesktopFileSelectionOptions,
  DesktopNativeFilePort,
  ElectronBridgeResult,
  ElectronNativeFileBridge,
  ElectronPreloadBridge,
} from "../../shared/index.js";

export function createElectronNativeFilePort(
  bridge: ElectronPreloadBridge,
): DesktopNativeFilePort | undefined {
  const files = bridge.files;
  if (files === undefined) return undefined;
  return Object.freeze({
    selectFile: async (options?: DesktopFileSelectionOptions) =>
      unwrap(await files.selectFile(options)),
    selectDirectory: async (options?: DesktopFileSelectionOptions) =>
      unwrap(await files.selectDirectory(options)),
    previewFile: async (referenceId: string) => {
      unwrap(await files.previewFile(referenceId));
    },
  });
}

function unwrap<TValue>(result: ElectronBridgeResult<TValue>): TValue {
  if (result.ok) return result.value;
  throw new ApiTransportError(
    result.error.code,
    result.error.retryable,
    "Electron native file operation failed",
  );
}

export type { ElectronNativeFileBridge };
export type { FrontendFileReference };
