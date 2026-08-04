/**
 * Composes the child-process Conversation placement for the desktop Runtime:
 * launcher over the desktop child entrypoint plus the persistence-bound
 * parent endpoint factory.
 */
import { noopLogger, type Logger } from "../../../observability/index.js";
import {
  DesktopRuntimeChildEndpointFactory,
  type DesktopRuntimeChildPersistenceProvider,
} from "../child/DesktopRuntimeChildEndpointFactory.js";
import type { ParentRuntimeChildIdentityFactory } from "../child/index.js";
import { NodeConversationProcessSupervisor } from "./NodeConversationProcessSupervisor.js";
import { NodeRuntimeChildProcessLauncher } from "./RuntimeChildProcessLauncher.js";
import type { RuntimeProcessExitNormalizer } from "./RuntimeProcessExitNormalizer.js";

export interface ChildProcessConversationRuntimePlacementOptions {
  readonly command: string;
  readonly args?: readonly string[];
  readonly persistenceProvider: DesktopRuntimeChildPersistenceProvider;
  readonly sessionIdFactory?: ParentRuntimeChildIdentityFactory;
  readonly exitNormalizer?: RuntimeProcessExitNormalizer;
  readonly env?: Readonly<Record<string, string>>;
  readonly logger?: Logger;
}

export function createChildProcessConversationRuntimePlacement(
  options: ChildProcessConversationRuntimePlacementOptions,
): NodeConversationProcessSupervisor {
  const logger = (options.logger ?? noopLogger).child({
    component: "child_process_conversation_runtime_placement",
  });
  return new NodeConversationProcessSupervisor({
    launcher: new NodeRuntimeChildProcessLauncher({
      command: options.command,
      args: options.args ?? [],
      ...(options.env === undefined ? {} : { env: options.env }),
      logger,
    }),
    endpointFactory: new DesktopRuntimeChildEndpointFactory({
      persistenceProvider: options.persistenceProvider,
      ...(options.sessionIdFactory === undefined
        ? {}
        : { sessionIdFactory: options.sessionIdFactory }),
      logger,
    }),
    ...(options.exitNormalizer === undefined
      ? {}
      : { exitNormalizer: options.exitNormalizer }),
    logger,
  });
}
