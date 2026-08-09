/** Composes the desktop child-process Runtime placement for one Workspace. */
import { fileURLToPath } from "node:url";
import type { Logger } from "@novel/core";
import {
  DESKTOP_CHILD_DEBUG_ENV,
  DESKTOP_CHILD_LOG_ENV,
  DESKTOP_CHILD_STORAGE_ROOT_ENV,
  DESKTOP_PROVIDER_REQUEST_DUMP_ENV,
  NodeConversationProcessSupervisor,
  createChildProcessConversationRuntimePlacement,
  type DesktopRuntimeChildPersistence,
  type DesktopRuntimeChildSubagent,
} from "@novel/core/node";

export interface DesktopRuntimeApplicationPersistenceProvider {
  getRuntimePersistence(conversationId: string): Promise<DesktopRuntimeChildPersistence>;
  getRuntimeSubagent(conversationId: string): Promise<DesktopRuntimeChildSubagent>;
}

export interface CreateDesktopRuntimePlacementOptions {
  readonly storageRoot: string;
  readonly childLogPath?: string;
  readonly debugLogLevel?: "debug" | "verbose";
  readonly providerRequestDumpPath?: string;
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
      ...(options.childLogPath === undefined
        ? {}
        : { [DESKTOP_CHILD_LOG_ENV]: options.childLogPath }),
      ...(options.debugLogLevel === undefined
        ? {}
        : { [DESKTOP_CHILD_DEBUG_ENV]: options.debugLogLevel }),
      ...(options.providerRequestDumpPath === undefined
        ? {}
        : { [DESKTOP_PROVIDER_REQUEST_DUMP_ENV]: options.providerRequestDumpPath }),
    },
    persistenceProvider: {
      provide: async (bootstrap) => {
        const application = await options.applicationProvider();
        if (application === undefined) {
          throw new TypeError(
            "Desktop Conversation application is not open",
          );
        }
        return application.getRuntimePersistence(
          bootstrap.conversation.metadata.id,
        );
      },
    },
    subagentProvider: {
      provide: async (bootstrap) => {
        const application = await options.applicationProvider();
        if (application === undefined) {
          throw new TypeError(
            "Desktop Conversation application is not open",
          );
        }
        return application.getRuntimeSubagent(
          bootstrap.conversation.metadata.id,
        );
      },
    },
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });
}
