/** Composes Conversation and Novel hosts so one Electron Workspace becomes ready atomically. */
import {
  ConversationNovelLifecycleOutputPublisher,
  noopLogger,
  type ApiTransport,
  type ConversationRuntimePlacement,
  type EntityProfileReadinessPolicy,
  type Logger,
  type WorkspaceStoreLocation,
} from "@novel/core";
import {
  NodeConversationApiApplication,
  NodeNovelWorkspaceHost,
} from "@novel/core/node";
import {
  DesktopUnavailableConversationRuntimePlacement,
} from "../conversation/DesktopConversationApiApplicationFactory.js";
import type {
  DesktopWorkspaceApiApplication,
  DesktopWorkspaceApiApplicationFactory,
} from "./DesktopWorkspaceService.js";

export interface DesktopNovelWorkspaceApplicationFactoryOptions {
  readonly placement?: ConversationRuntimePlacement;
  readonly readinessPolicy?: EntityProfileReadinessPolicy;
  readonly logger?: Logger;
}

export class DesktopNovelWorkspaceApplicationFactory
  implements DesktopWorkspaceApiApplicationFactory
{
  private readonly placement: ConversationRuntimePlacement;
  private readonly readinessPolicy: EntityProfileReadinessPolicy;
  private readonly logger: Logger;

  constructor(options: DesktopNovelWorkspaceApplicationFactoryOptions = {}) {
    this.placement =
      options.placement ?? new DesktopUnavailableConversationRuntimePlacement();
    this.readinessPolicy =
      options.readinessPolicy ?? DESKTOP_DEFAULT_READINESS_POLICY;
    this.logger = (options.logger ?? noopLogger).child({
      component: "desktop_novel_workspace_application_factory",
    });
  }

  async open(
    location: WorkspaceStoreLocation,
  ): Promise<DesktopWorkspaceApiApplication> {
    const logger = this.logger.child({ workspaceId: location.workspaceId });
    let conversationApplication: NodeConversationApiApplication | undefined;
    logger.info("desktop_workspace_application.open_started");
    try {
      conversationApplication = await NodeConversationApiApplication.open({
        workspace: location,
        placement: this.placement,
        logger,
      });
      const novelHost = await NodeNovelWorkspaceHost.open({
        workspace: location,
        lifecyclePublisher: new ConversationNovelLifecycleOutputPublisher(
          conversationApplication.outputPublisher,
        ),
        readinessPolicy: this.readinessPolicy,
        logger,
      });
      logger.info("desktop_workspace_application.open_completed", {
        novelId: novelHost.novelId,
        recoveryPhaseCount: novelHost.recoveryResult.phases.length,
      });
      return new DesktopNovelWorkspaceApplication(
        conversationApplication,
        novelHost,
        logger,
      );
    } catch {
      await conversationApplication?.close().catch(() => undefined);
      logger.info("desktop_workspace_application.open_failed");
      throw new DesktopNovelWorkspaceApplicationOpenError();
    }
  }
}

class DesktopNovelWorkspaceApplication implements DesktopWorkspaceApiApplication {
  readonly transport: ApiTransport;
  private closePromise?: Promise<void>;

  constructor(
    private readonly conversationApplication: NodeConversationApiApplication,
    private readonly novelHost: NodeNovelWorkspaceHost,
    private readonly logger: Logger,
  ) {
    this.transport = conversationApplication.transport;
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeOnce();
    return this.closePromise;
  }

  private async closeOnce(): Promise<void> {
    this.logger.info("desktop_workspace_application.close_started");
    const failures: string[] = [];
    await closeStage("novel_host", () => this.novelHost.close(), failures);
    await closeStage(
      "conversation_application",
      () => this.conversationApplication.close(),
      failures,
    );
    this.logger.info("desktop_workspace_application.close_completed", {
      failureCount: failures.length,
    });
    if (failures.length > 0) {
      throw new DesktopNovelWorkspaceApplicationCloseError(failures);
    }
  }
}

export class DesktopNovelWorkspaceApplicationOpenError extends Error {
  readonly code = "DESKTOP_NOVEL_WORKSPACE_APPLICATION_OPEN_FAILED";

  constructor() {
    super("Desktop Novel Workspace application failed to open");
    this.name = "DesktopNovelWorkspaceApplicationOpenError";
  }
}

export class DesktopNovelWorkspaceApplicationCloseError extends Error {
  readonly code = "DESKTOP_NOVEL_WORKSPACE_APPLICATION_CLOSE_FAILED";
  readonly failedStages: readonly string[];

  constructor(failedStages: readonly string[]) {
    super("Desktop Novel Workspace application failed to close cleanly");
    this.name = "DesktopNovelWorkspaceApplicationCloseError";
    this.failedStages = Object.freeze([...failedStages]);
  }
}

const DESKTOP_DEFAULT_READINESS_POLICY: EntityProfileReadinessPolicy =
  Object.freeze({
    evaluateCharacter: () => Object.freeze([]),
    evaluateLocation: () => Object.freeze([]),
  });

async function closeStage(
  stage: string,
  close: () => Promise<void>,
  failures: string[],
): Promise<void> {
  try {
    await close();
  } catch {
    failures.push(stage);
  }
}
