/** Composes Conversation and Novel hosts so one Electron Workspace becomes ready atomically. */
import {
  ConversationNovelLifecycleOutputPublisher,
  NovelQueryApiRouter,
  WorkspaceApiRouter,
  noopLogger,
  type ApiTransport,
  type ConversationRuntimePlacement,
  type AgentManifestProvisioner,
  type EntityProfileReadinessPolicy,
  type Logger,
  type WorkspaceStoreLocation,
} from "@novel/core";
import {
  DefaultNovelConversationManifestProvisioner,
  type DesktopRuntimeChildPersistence,
  NodeConversationApiApplication,
  NodeNovelWorkspaceHost,
  NodeConversationProcessSupervisor,
} from "@novel/core/node";
import { createDesktopRuntimePlacement } from "../runtime/index.js";
import type {
  DesktopWorkspaceApiApplication,
  DesktopWorkspaceApiApplicationFactory,
} from "./DesktopWorkspaceService.js";

export interface DesktopNovelWorkspaceApplicationFactoryOptions {
  readonly placement?: ConversationRuntimePlacement;
  readonly storageRoot?: string;
  readonly childLogPath?: string;
  readonly debugLogLevel?: "debug" | "verbose";
  readonly providerRequestDumpPath?: string;
  readonly agentManifestProvisioner?: AgentManifestProvisioner;
  readonly readinessPolicy?: EntityProfileReadinessPolicy;
  readonly logger?: Logger;
}

export class DesktopNovelWorkspaceApplicationFactory
  implements DesktopWorkspaceApiApplicationFactory
{
  private readonly placementOverride?: ConversationRuntimePlacement;
  private readonly storageRoot?: string;
  private readonly childLogPath?: string;
  private readonly debugLogLevel?: "debug" | "verbose";
  private readonly providerRequestDumpPath?: string;
  private readonly agentManifestProvisioner: AgentManifestProvisioner;
  private readonly readinessPolicy: EntityProfileReadinessPolicy;
  private readonly logger: Logger;

  constructor(options: DesktopNovelWorkspaceApplicationFactoryOptions = {}) {
    this.placementOverride = options.placement;
    this.storageRoot = options.storageRoot;
    this.childLogPath = options.childLogPath;
    this.debugLogLevel = options.debugLogLevel;
    this.providerRequestDumpPath = options.providerRequestDumpPath;
    this.agentManifestProvisioner =
      options.agentManifestProvisioner ??
      new DefaultNovelConversationManifestProvisioner({
        logger: options.logger,
      });
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
    let runtimePlacement: NodeConversationProcessSupervisor | undefined;
    logger.info("desktop_workspace_application.open_started");
    try {
      const placement =
        this.placementOverride ??
        createDesktopRuntimePlacement({
          storageRoot: requireStorageRoot(this.storageRoot, location),
          ...(this.childLogPath === undefined
            ? {}
            : { childLogPath: this.childLogPath }),
          ...(this.debugLogLevel === undefined
            ? {}
            : { debugLogLevel: this.debugLogLevel }),
          ...(this.providerRequestDumpPath === undefined
            ? {}
            : { providerRequestDumpPath: this.providerRequestDumpPath }),
          applicationProvider: async () => conversationApplication,
          logger,
        });
      runtimePlacement =
        placement instanceof NodeConversationProcessSupervisor
          ? placement
          : undefined;
      conversationApplication = await NodeConversationApiApplication.open({
        workspace: location,
        placement,
        agentManifestProvisioner: this.agentManifestProvisioner,
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
        runtimePlacement,
        logger,
      );
    } catch {
      await conversationApplication?.close().catch(() => undefined);
      await runtimePlacement?.close().catch(() => undefined);
      logger.info("desktop_workspace_application.open_failed");
      throw new DesktopNovelWorkspaceApplicationOpenError();
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

class DesktopNovelWorkspaceApplication implements DesktopWorkspaceApiApplication {
  readonly transport: ApiTransport;
  private closePromise?: Promise<void>;

  constructor(
    private readonly conversationApplication: NodeConversationApiApplication,
    private readonly novelHost: NodeNovelWorkspaceHost,
    private readonly runtimePlacement: NodeConversationProcessSupervisor | undefined,
    private readonly logger: Logger,
  ) {
    this.transport = new WorkspaceApiRouter({
      conversations: conversationApplication.transport,
      novel: new NovelQueryApiRouter({
        workspaceId: novelHost.workspaceId,
        novelId: novelHost.novelId,
        metadata: novelHost,
        drafts: novelHost.drafts,
        characters: novelHost.application.characterQueries,
        locations: novelHost.application.locationQueries,
        outline: novelHost.application.outlineQueries,
        publication: novelHost.application.publicationQueries,
        paragraphs: novelHost.application.paragraphQueries,
        logger,
      }),
    });
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
    await closeStage(
      "runtime_placement",
      () => this.runtimePlacement?.close() ?? Promise.resolve(),
      failures,
    );
    this.logger.info("desktop_workspace_application.close_completed", {
      failureCount: failures.length,
    });
    if (failures.length > 0) {
      throw new DesktopNovelWorkspaceApplicationCloseError(failures);
    }
  }

  getRuntimePersistence(
    conversationId: string,
  ): Promise<DesktopRuntimeChildPersistence> {
    return this.conversationApplication.getRuntimePersistence(conversationId);
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
