/** Opens one provider-neutral Core Conversation application for an Electron Workspace. */
import type {
  ConversationRuntimeBootstrap,
  ConversationRuntimeHandle,
  ConversationRuntimePlacement,
  Logger,
  WorkspaceStoreLocation,
} from "@novel/core";
import { NodeConversationApiApplication } from "@novel/core/node";
import type {
  DesktopWorkspaceApiApplication,
  DesktopWorkspaceApiApplicationFactory,
} from "../workspace/DesktopWorkspaceService.js";

export interface DesktopConversationApiApplicationFactoryOptions {
  readonly placement?: ConversationRuntimePlacement;
  readonly logger?: Logger;
}

export class DesktopConversationApiApplicationFactory
  implements DesktopWorkspaceApiApplicationFactory
{
  private readonly placement: ConversationRuntimePlacement;
  private readonly logger?: Logger;

  constructor(options: DesktopConversationApiApplicationFactoryOptions = {}) {
    this.placement =
      options.placement ?? new DesktopUnavailableConversationRuntimePlacement();
    this.logger = options.logger;
  }

  open(
    location: WorkspaceStoreLocation,
  ): Promise<DesktopWorkspaceApiApplication> {
    return NodeConversationApiApplication.open({
      workspace: location,
      placement: this.placement,
      ...(this.logger !== undefined ? { logger: this.logger } : {}),
    });
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
