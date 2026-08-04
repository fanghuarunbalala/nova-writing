/**
 * Real Model Connection probe reusing the Runtime resolver and Provider
 * factory without creating Conversation history or persisting responses.
 */
import { performance } from "node:perf_hooks";
import type {
  Api,
  AssistantMessageEventStream,
  Context,
  Model,
} from "@earendil-works/pi-ai";
import {
  EffectiveModelExecutionError,
  EffectiveModelExecutionResolver,
  isModelConnectionProbeFailure,
  type ApplicationConfigurationStore,
  type CredentialStore,
  type ModelConnectionProbeFailure,
  type ModelConnectionProbeResult,
} from "../../config/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import {
  PiAiProviderExecutionDispatcher,
  PiProviderExecutionFactory,
  SUPPORTED_PI_EXECUTION_APIS,
  createPiExecutionModel,
  type PiProviderDispatchHooks,
} from "../../runtime/agent/pi/index.js";

export interface ModelConnectionProbeServiceOptions {
  readonly application: ApplicationConfigurationStore;
  readonly credentials: CredentialStore;
  readonly resolver?: EffectiveModelExecutionResolver;
  readonly executionFactory?: PiProviderExecutionFactory;
  readonly logger?: Logger;
}

export class ModelConnectionProbeService {
  readonly #application: ApplicationConfigurationStore;
  readonly #resolver: EffectiveModelExecutionResolver;
  readonly #executionFactory: PiProviderExecutionFactory;
  readonly #logger: Logger;

  constructor(options: ModelConnectionProbeServiceOptions) {
    this.#application = options.application;
    const logger = (options.logger ?? noopLogger).child({
      component: "model_connection_probe_service",
    });
    this.#logger = logger;
    this.#resolver =
      options.resolver ??
      new EffectiveModelExecutionResolver({
        credentials: options.credentials,
        supportedApis: SUPPORTED_PI_EXECUTION_APIS,
        logger,
      });
    this.#executionFactory =
      options.executionFactory ??
      new PiProviderExecutionFactory({
        dispatcher: new PiAiProviderExecutionDispatcher(),
        credentials: options.credentials,
        logger,
      });
  }

  async probe(): Promise<ModelConnectionProbeResult> {
    let descriptor;
    try {
      descriptor = await this.#resolver.resolve({
        application: this.#application,
      });
    } catch (error) {
      if (error instanceof EffectiveModelExecutionError) {
        return Object.freeze({ ok: false, failure: error.failure });
      }
      this.#logger.info("model_connection_probe.resolve_failed", {
        failure: "configuration_unavailable",
      });
      return Object.freeze({
        ok: false,
        failure: "configuration_unavailable",
      });
    }
    const startedAt = performance.now();
    try {
      const streamFunction = this.#executionFactory.create(descriptor);
      const stream = await streamFunction(
        createProbeModel(descriptor),
        PROBE_CONTEXT,
        undefined,
        NOOP_PROBE_HOOKS,
      );
      const failure = await consumeProbeStream(stream);
      const latencyMs = Math.round(performance.now() - startedAt);
      if (failure !== undefined) {
        this.#logger.info("model_connection_probe.failed", { failure });
        return Object.freeze({ ok: false, failure });
      }
      this.#logger.debug("model_connection_probe.completed", { latencyMs });
      return Object.freeze({ ok: true, latencyMs });
    } catch {
      this.#logger.info("model_connection_probe.failed", {
        failure: "network",
      });
      return Object.freeze({ ok: false, failure: "network" });
    }
  }
}

async function consumeProbeStream(
  stream: AssistantMessageEventStream,
): Promise<ModelConnectionProbeFailure | undefined> {
  for await (const event of stream) {
    if (event.type === "error") {
      return captureProbeFailure(event.error.errorMessage);
    }
    if (event.type === "done") {
      return undefined;
    }
  }
  return undefined;
}

function captureProbeFailure(value: unknown): ModelConnectionProbeFailure {
  return isModelConnectionProbeFailure(value) ? value : "network";
}

function createProbeModel(
  descriptor: Parameters<typeof createPiExecutionModel>[0],
): Model<Api> {
  return createPiExecutionModel(descriptor, PROBE_MODEL_SOURCE);
}

const PROBE_MODEL_SOURCE = Object.freeze({
  id: "probe-model",
  name: "Probe Model",
  api: "openai-completions",
  provider: "openai",
  baseUrl: "https://probe.invalid",
  reasoning: false,
  input: Object.freeze(["text"]),
  cost: Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }),
  contextWindow: 8192,
  maxTokens: 128,
}) as Model<Api>;

const PROBE_CONTEXT: Context = {
  systemPrompt: "Connection probe.",
  messages: [{ role: "user", content: "probe", timestamp: 0 }],
};

const NOOP_PROBE_HOOKS: PiProviderDispatchHooks = Object.freeze({
  async onDispatched() {},
  async onFailedBeforeDispatch() {},
});
