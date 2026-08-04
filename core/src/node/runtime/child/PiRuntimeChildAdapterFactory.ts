/**
 * Production Pi Agent adapter factory for the desktop child Runtime: resolves
 * the effective Model execution, builds the Pi client and adapter with the
 * live Turn lifecycle, and dispatches through the Pi Provider stream factory.
 */
import { Agent } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
  EffectiveModelExecutionResolver,
  type ApplicationConfigurationStore,
  type CredentialStore,
} from "../../../config/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import {
  CompositePiAgentEventBridge,
  CorePiRuntimeMessageConverter,
  PiAgentCoreAdapter,
  PiAiProviderExecutionDispatcher,
  PiProviderExecutionFactory,
  PiTurnLifecycleBridge,
  SUPPORTED_PI_EXECUTION_APIS,
  asPiAgentCoreClient,
  createPiExecutionModel,
} from "../../../runtime/agent/pi/index.js";
import type { AgentRuntimeAdapter } from "../../../runtime/index.js";
import type { RuntimeChildAdapterFactory } from "./DesktopRuntimeChildCompositionFactory.js";

export interface PiRuntimeChildAdapterFactoryOptions {
  readonly application: ApplicationConfigurationStore;
  readonly credentials: CredentialStore;
  readonly resolver?: EffectiveModelExecutionResolver;
  readonly providerExecutionFactory?: PiProviderExecutionFactory;
  readonly baseModel?: Model<Api>;
  readonly logger?: Logger;
}

const DEFAULT_BASE_MODEL: Model<Api> = Object.freeze({
  id: "desktop-child-model",
  name: "Desktop Child Model",
  api: "openai-completions",
  provider: "openai",
  baseUrl: "https://child.invalid",
  reasoning: false,
  input: Object.freeze(["text"]),
  cost: Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }),
  contextWindow: 8192,
  maxTokens: 1024,
}) as Model<Api>;

export class PiRuntimeChildAdapterFactory implements RuntimeChildAdapterFactory {
  readonly #application: ApplicationConfigurationStore;
  readonly #resolver: EffectiveModelExecutionResolver;
  readonly #providerExecutionFactory: PiProviderExecutionFactory;
  readonly #baseModel: Model<Api>;
  readonly #logger: Logger;

  constructor(options: PiRuntimeChildAdapterFactoryOptions) {
    const logger = (options.logger ?? noopLogger).child({
      component: "pi_runtime_child_adapter_factory",
    });
    this.#application = options.application;
    this.#resolver =
      options.resolver ??
      new EffectiveModelExecutionResolver({
        credentials: options.credentials,
        supportedApis: SUPPORTED_PI_EXECUTION_APIS,
        logger,
      });
    this.#providerExecutionFactory =
      options.providerExecutionFactory ??
      new PiProviderExecutionFactory({
        dispatcher: new PiAiProviderExecutionDispatcher(),
        credentials: options.credentials,
        logger,
      });
    this.#baseModel = options.baseModel ?? DEFAULT_BASE_MODEL;
    this.#logger = logger;
  }

  async create({
    configuration,
    lifecycleController,
    nudgeProviderCalls,
  }: Parameters<RuntimeChildAdapterFactory["create"]>[0]): Promise<AgentRuntimeAdapter> {
    try {
      return await this.#createOnce({
        configuration,
        lifecycleController,
        nudgeProviderCalls,
      });
    } catch (error) {
      this.#logger.error("pi_runtime_child.adapter_failed", {
        conversationId: configuration.conversationId,
        failure: captureStableFailure(error),
      });
      throw error;
    }
  }

  async #createOnce({
    configuration,
    lifecycleController,
    nudgeProviderCalls,
  }: Parameters<RuntimeChildAdapterFactory["create"]>[0]): Promise<AgentRuntimeAdapter> {
    const conversationId = configuration.conversationId;
    const descriptor = await this.#resolver.resolve({
      application: this.#application,
    });
    const model = createPiExecutionModel(descriptor, this.#baseModel);
    const dispatchAwareStreamFunction = this.#providerExecutionFactory.create(
      descriptor,
    );
    const agent = new Agent({
      initialState: {
        model,
        systemPrompt: "",
        messages: [],
        tools: [],
      },
      streamFn: async () => {
        throw new TypeError("Base Pi stream function is not configured");
      },
    });
    const eventBridge = new CompositePiAgentEventBridge([
      new PiTurnLifecycleBridge({
        conversationId,
        lifecycleController,
        logger: this.#logger,
      }),
    ]);
    const adapter = new PiAgentCoreAdapter({
      agent: asPiAgentCoreClient(agent),
      messageConverter: new CorePiRuntimeMessageConverter({
        logger: this.#logger,
      }),
      eventBridge,
      dispatchAwareStreamFunction,
      ...(nudgeProviderCalls === undefined
        ? {}
        : { nudgeProviderCalls }),
      logger: this.#logger,
    });
    this.#logger.info("pi_runtime_child.adapter_created", {
      conversationId,
      api: descriptor.api,
    });
    return adapter;
  }
}

function captureStableFailure(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
    return error.name;
  }
  return "unknown";
}
