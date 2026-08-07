/**
 * Production Runtime run preparation source for the desktop child: reads
 * persisted messages through the Runtime persistence RPC and resolves the
 * Manifest-bound system prompt. Advanced projection passes remain outside the
 * child scope and surface stable unsupported failures.
 */
import {
  AgentRuntimeBasePromptSource,
  ProjectedUserMessageRunPreparationSource,
  RuntimeSystemPromptBuilder,
} from "../../../runtime/index.js";
import type { AgentRuntimeConfiguration } from "../../../runtime/agent/index.js";
import { ResolvedPromptSectionItem } from "../../../agent/manifest/index.js";
import type { ConversationMessageFileStore } from "../../../storage/index.js";
import type { ConversationMessageProjectionService } from "../../../storage/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import {
  DynamicPromptSection,
  type PromptDigester,
  type PromptSectionRegistry,
} from "../../../prompt/index.js";
import type { RuntimeRunPreparationSourceFactory } from "./DesktopRuntimeChildCompositionFactory.js";

export interface DefaultRuntimeRunPreparationSourceFactoryOptions {
  /** Section registry for resolving recipe items; enables dynamic sections. */
  readonly sections?: PromptSectionRegistry;
  /** Digest for the runtime-assembled final prompt. */
  readonly digester?: PromptDigester;
  /** Lazy model id resolver; failure degrades to omitting the model line. */
  readonly resolveModelId?: () => Promise<string | undefined>;
  readonly logger?: Logger;
}

const PLATFORM_LABELS: Readonly<Record<string, string>> = Object.freeze({
  darwin: "macOS",
  linux: "Linux",
  win32: "Windows",
});

export class DefaultRuntimeRunPreparationSourceFactory
  implements RuntimeRunPreparationSourceFactory
{
  readonly #sections?: PromptSectionRegistry;
  readonly #digester?: PromptDigester;
  readonly #resolveModelId?: () => Promise<string | undefined>;
  readonly #logger: Logger;

  constructor(options: DefaultRuntimeRunPreparationSourceFactoryOptions = {}) {
    this.#sections = options.sections;
    this.#digester = options.digester;
    this.#resolveModelId = options.resolveModelId;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "default_runtime_run_preparation_source_factory",
    });
  }

  async create({
    configuration,
    bootstrap,
    persistence,
  }: Parameters<RuntimeRunPreparationSourceFactory["create"]>[0]) {
    const conversationId = bootstrap.conversation.metadata.id;
    const staticSource = new AgentRuntimeBasePromptSource(configuration);
    const dynamicSections = this.#deriveDynamicSections(configuration);
    const basePromptSource =
      this.#digester !== undefined && dynamicSections.length > 0
        ? new RuntimeSystemPromptBuilder({
            staticSource,
            dynamicSections,
            input: async () => {
              const modelId = await this.#resolveModelIdSafe();
              return {
                environment: {
                  workdir: bootstrap.workspace.workdir,
                  platform:
                    PLATFORM_LABELS[process.platform] ?? process.platform,
                  ...(modelId === undefined ? {} : { modelId }),
                },
              };
            },
            digester: this.#digester,
            logger: this.#logger,
          })
        : staticSource;
    const source = new ProjectedUserMessageRunPreparationSource({
      conversationId,
      projections: createChildProjectionService(conversationId, persistence),
      messages: {
        list: (query: Parameters<ConversationMessageFileStore["list"]>[0]) =>
          persistence.messages.list(query),
      } as ConversationMessageFileStore,
      basePromptSource,
      logger: this.#logger,
    });
    this.#logger.debug("runtime_run_preparation_source.created", {
      conversationId,
    });
    return source;
  }

  /** 从 manifest recipe 解析本 agent 的动态段。Resolves this agent's dynamic sections from the manifest recipe. */
  #deriveDynamicSections(
    configuration: AgentRuntimeConfiguration,
  ): readonly DynamicPromptSection[] {
    if (this.#sections === undefined) {
      return Object.freeze([]);
    }
    const recipe = configuration.assembly.manifest.promptRecipe;
    const result: DynamicPromptSection[] = [];
    for (const item of recipe.items) {
      if (!(item instanceof ResolvedPromptSectionItem)) {
        continue;
      }
      const section = this.#sections.resolve(item.sectionId, item.version);
      if (section.kind === "dynamic") {
        if (!(section instanceof DynamicPromptSection)) {
          throw new TypeError(
            "Dynamic-kind Prompt Section must extend DynamicPromptSection",
          );
        }
        result.push(section);
      }
    }
    return Object.freeze(result);
  }

  async #resolveModelIdSafe(): Promise<string | undefined> {
    if (this.#resolveModelId === undefined) {
      return undefined;
    }
    try {
      return await this.#resolveModelId();
    } catch (error) {
      this.#logger.debug("environment.model_resolution_failed", {
        failure: error instanceof Error ? error.name : "unknown",
      });
      return undefined;
    }
  }
}

function createChildProjectionService(
  conversationId: string,
  persistence: Parameters<RuntimeRunPreparationSourceFactory["create"]>[0]["persistence"],
): ConversationMessageProjectionService {
  return Object.freeze({
    inspect: async () => {
      throw new TypeError(
        "Runtime child projection inspection is outside the desktop V1 scope",
      );
    },
    synchronize: async (cid: string) => {
      const [messagesPage, journalPage] = await Promise.all([
        persistence.messages.list({
          conversationId: cid,
          afterMessageIndex: 0,
        }),
        persistence.journal.listEvents({
          conversationId: cid,
          anchor: { from: "start" },
          limit: 1,
        }),
      ]);
      return Object.freeze({
        workspaceId: "desktop-child",
        projectorId: "core.conversation-message",
        projectorVersion: "1",
        conversationId: cid,
        operations: Object.freeze([]),
        previousSequence: messagesPage.projectedThroughSequence,
        projectedThroughSequence: messagesPage.projectedThroughSequence,
        journalHighWatermark: journalPage.highWatermark,
        processedEventCount: messagesPage.items.length,
        appendedMessageCount: 0,
      });
    },
    rebuild: async () => {
      throw new TypeError(
        "Runtime child projection rebuild is outside the desktop V1 scope",
      );
    },
  });
}
