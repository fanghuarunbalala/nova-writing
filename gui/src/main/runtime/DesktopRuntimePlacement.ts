/** Composes the desktop child-process Runtime placement for one Workspace. */
import { fileURLToPath } from "node:url";
import type { Logger } from "@novel/core";
import {
  DESKTOP_CHILD_STORAGE_ROOT_ENV,
  NodeConversationProcessSupervisor,
  createChildProcessConversationRuntimePlacement,
  type DesktopRuntimeChildPersistence,
} from "@novel/core/node";

export interface DesktopRuntimeApplicationPersistenceProvider {
  getRuntimePersistence(): Promise<DesktopRuntimeChildPersistence>;
}

export interface CreateDesktopRuntimePlacementOptions {
  readonly storageRoot: string;
  readonly applicationProvider: () => Promise<
    DesktopRuntimeApplicationPersistenceProvider | undefined
  >;
  readonly logger?: Logger;
}

export function createDesktopRuntimePlacement(
  options: CreateDesktopRuntimePlacementOptions,
): NodeConversationProcessSupervisor {
  const childMain = fileURLToPath(
    new URL("./RuntimeChildMain.js", import.meta.url),
  );
  return createChildProcessConversationRuntimePlacement({
    command: process.execPath,
    args: [childMain],
    env: {
      ELECTRON_RUN_AS_NODE: "1",
      [DESKTOP_CHILD_STORAGE_ROOT_ENV]: options.storageRoot,
    },
    persistenceProvider: {
      provide: async () => {
        const application = await options.applicationProvider();
        if (application === undefined) {
          throw new TypeError(
            "Desktop Conversation application is not open",
          );
        }
        return application.getRuntimePersistence();
      },
    },
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });
}
