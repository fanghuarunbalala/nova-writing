/** Opens one provider-neutral Core Conversation application for an Electron Workspace. */
import type {
  ConversationRuntimeBootstrap,
  ConversationRuntimeHandle,
  ConversationRuntimePlacement,
  Logger,
  WorkspaceStoreLocation,
  ApiTransport,
} from "@novel/core";
import {
  NodeConversationApiApplication,
  NodeConversationProcessSupervisor,
} from "@novel/core/node";
import { createDesktopRuntimePlacement } from "../runtime/index.js";
import type {
  DesktopWorkspaceApiApplication,
  DesktopWorkspaceApiApplicationFactory,
} from "../workspace/DesktopWorkspaceService.js";

export interface DesktopConversationApiApplicationFactoryOptions {
  readonly placement?: ConversationRuntimePlacement;
  readonly storageRoot?: string;
  readonly logger?: Logger;
}

export class DesktopConversationApiApplicationFactory
  implements DesktopWorkspaceApiApplicationFactory
{
  private readonly placementOverride?: ConversationRuntimePlacement;
  private readonly storageRoot?: string;
  private readonly logger?: Logger;

  constructor(options: DesktopConversationApiApplicationFactoryOptions = {}) {
    this.placementOverride = options.placement;
    this.storageRoot = options.storageRoot;
    this.logger = options.logger;
  }

  async open(
    location: WorkspaceStoreLocation,
  ): Promise<DesktopWorkspaceApiApplication> {
    let application: NodeConversationApiApplication | undefined;
    let runtimePlacement: NodeConversationProcessSupervisor | undefined;
    const placement =
      this.placementOverride ??
      createDesktopRuntimePlacement({
        storageRoot: requireStorageRoot(this.storageRoot, location),
        applicationProvider: async () => application,
        ...(this.logger === undefined ? {} : { logger: this.logger }),
      });
    runtimePlacement =
      placement instanceof NodeConversationProcessSupervisor
        ? placement
        : undefined;
    try {
      application = await NodeConversationApiApplication.open({
        workspace: location,
        placement,
        ...(this.logger !== undefined ? { logger: this.logger } : {}),
      });
      return new DesktopConversationRuntimeApplication(
        application,
        runtimePlacement,
      );
    } catch (error) {
      await runtimePlacement?.close().catch(() => undefined);
      throw error;
    }
  }
}

function requireStorageRoot(
  configured: string | undefined,
  location: WorkspaceStoreLocation,
): string {
  if (configured !== undefined && configured.length > 0) return configured;
  throw new TypeError(
    `Desktop Runtime storage root is not configured for ${location.workspaceId}`,
  );
}

class DesktopConversationRuntimeApplication
  implements DesktopWorkspaceApiApplication
{
  readonly transport: ApiTransport;

  constructor(
    private readonly application: NodeConversationApiApplication,
    private readonly runtimePlacement: NodeConversationProcessSupervisor | undefined,
  ) {
    this.transport = application.transport;
  }

  close(): Promise<void> {
    return Promise.allSettled([
      this.application.close(),
      this.runtimePlacement?.close() ?? Promise.resolve(),
    ]).then(() => undefined);
  }
}

export class DesktopUnavailableConversationRuntimePlacement
  implements ConversationRuntimePlacement
{
  activate(
    _bootstrap: ConversationRuntimeBootstrap,
  ): Promise<ConversationRuntimeHandle> {
    return Promise.reject(new DesktopConversationRuntimeUnavailableError());
  }
}

export class DesktopConversationRuntimeUnavailableError extends Error {
  readonly code = "DESKTOP_CONVERSATION_RUNTIME_UNAVAILABLE";

  constructor() {
    super("Desktop Conversation Runtime is not configured");
    this.name = "DesktopConversationRuntimeUnavailableError";
  }
}
