/**
 * One programmatic Conversation entry: opens the Workspace Conversation
 * application with production Manifest provisioning, exposes the typed client,
 * and injects a Runtime placement for activation.
 */
import {
  DefaultNovelApiClient,
  type ConversationRuntimeHandle,
  type ConversationRuntimePlacement,
  type Logger,
  type WorkspaceStoreLocation,
} from "../../index.js";
import { noopLogger } from "../../observability/index.js";
import type { AgentManifestProvisioner } from "../../agent/index.js";
import { DefaultNovelConversationManifestProvisioner } from "../agent/index.js";
import { NodeConversationApiApplication } from "./NodeConversationApiApplication.js";

export interface OpenDesktopConversationEntryOptions {
  readonly workspace: WorkspaceStoreLocation;
  readonly placement?: ConversationRuntimePlacement;
  readonly agentManifestProvisioner?: AgentManifestProvisioner;
  readonly logger?: Logger;
}

export class DesktopConversationEntry {
  readonly client: DefaultNovelApiClient;
  readonly #application: NodeConversationApiApplication;

  constructor(
    application: NodeConversationApiApplication,
    logger?: Logger,
  ) {
    this.#application = application;
    this.client = new DefaultNovelApiClient({
      transport: application.transport,
      ...(logger === undefined ? {} : { logger }),
    });
  }

  get application(): NodeConversationApiApplication {
    return this.#application;
  }

  close(): Promise<void> {
    return this.#application.close();
  }
}

export async function openDesktopConversationEntry(
  options: OpenDesktopConversationEntryOptions,
): Promise<DesktopConversationEntry> {
  const logger = (options.logger ?? noopLogger).child({
    component: "desktop_conversation_entrypoint",
  });
  const application = await NodeConversationApiApplication.open({
    workspace: options.workspace,
    placement:
      options.placement ?? new UnavailableConversationRuntimePlacement(),
    agentManifestProvisioner:
      options.agentManifestProvisioner ??
      new DefaultNovelConversationManifestProvisioner({ logger }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });
  return new DesktopConversationEntry(application, options.logger);
}

export class UnavailableConversationRuntimePlacement
  implements ConversationRuntimePlacement
{
  activate(): Promise<ConversationRuntimeHandle> {
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
