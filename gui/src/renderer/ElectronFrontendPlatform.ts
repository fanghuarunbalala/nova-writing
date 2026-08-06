/**
 * createElectronFrontendPlatform
 *
 * 把桌面原生 port（spec 5.4 DesktopNativeFilePort）适配为共享 FrontendPlatform
 * （spec 4.3）。files port 缺失时使用 disabled stub，保持 capabilities.fileSelection=false。
 *
 * 设计约束：
 * - DesktopNativeFilePort 同时满足 FileSelectionPort.selectFiles：直接委托
 * - clipboard / notifications 暂保留 disabled stub（Phase B.3 不接入）
 * - capabilities.fileSelection 跟随 files port 是否注入
 */
import type { FileSelectionPort, FrontendPlatform, SelectFrontendFilesRequest } from "@novel/ui";
import type { DesktopNativeFilePort } from "../shared/index.js";

export interface ElectronFrontendPlatformOptions {
  readonly files?: DesktopNativeFilePort;
}

export function createElectronFrontendPlatform(
  options: ElectronFrontendPlatformOptions = {},
): FrontendPlatform {
  const filesPort = options.files;
  const files: FileSelectionPort =
    filesPort === undefined
      ? Object.freeze({
          selectFiles: async () => Object.freeze([]),
        })
      : Object.freeze({
          selectFiles: async (request?: SelectFrontendFilesRequest) =>
            filesPort.selectFile(
              request === undefined
                ? undefined
                : {
                    ...(request.multiple === undefined ? {} : { multiple: request.multiple }),
                    ...(request.accept === undefined ? {} : { accept: request.accept }),
                  },
            ),
        });
  return Object.freeze({
    capabilities: Object.freeze({
      fileSelection: filesPort !== undefined,
      clipboardRead: false,
      clipboardWrite: false,
      notifications: false,
    }),
    files,
    clipboard: Object.freeze({
      readText: async () => "",
      writeText: async () => undefined,
    }),
    notifications: Object.freeze({
      show: async () => undefined,
    }),
  });
}
