/**
 * Internal factory turning a secret-free execution descriptor into the
 * dispatch-aware Provider stream function consumed by PiAgentCoreAdapter.
 */
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
  StopReason,
  Usage,
} from "@earendil-works/pi-ai";
import type {
  CredentialReference,
  CredentialVault,
  EffectiveModelExecutionDescriptor,
} from "../../../config/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { PiDispatchAwareStreamFunction } from "./PiDispatchAwareStreamFunction.js";
import {
  PI_PROVIDER_EXECUTION_FAILURE,
  PiProviderExecutionError,
  type PiProviderExecutionFailure,
} from "./PiProviderExecutionErrors.js";

export const SUPPORTED_PI_EXECUTION_APIS = Object.freeze([
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
] as const);

export type SupportedPiExecutionApi =
  (typeof SUPPORTED_PI_EXECUTION_APIS)[number];

export function isSupportedPiExecutionApi(
  value: string,
): value is SupportedPiExecutionApi {
  return (SUPPORTED_PI_EXECUTION_APIS as readonly string[]).includes(value);
}

export interface PiProviderExecutionDispatcher {
  stream(
    api: SupportedPiExecutionApi,
    model: Model<Api>,
    context: Context,
    options: SimpleStreamOptions,
  ): AssistantMessageEventStream;
}

export interface PiProviderExecutionFactoryOptions {
  readonly dispatcher: PiProviderExecutionDispatcher;
  readonly credentials: CredentialVault;
  readonly logger?: Logger;
}

interface DispatchState {
  status?: number;
}

export class PiProviderExecutionFactory {
  readonly #dispatcher: PiProviderExecutionDispatcher;
  readonly #credentials: CredentialVault;
  readonly #logger: Logger;

  constructor(options: PiProviderExecutionFactoryOptions) {
    this.#dispatcher = options.dispatcher;
    this.#credentials = options.credentials;
    this.#logger = (options.logger ?? noopLogger).child({
      component: "pi_provider_execution_factory",
    });
  }

  create(descriptor: EffectiveModelExecutionDescriptor): PiDispatchAwareStreamFunction {
    if (!isSupportedPiExecutionApi(descriptor.api)) {
      return createUnsupportedStreamFunction(this.#logger);
    }
    return (model, context, options, hooks) =>
      this.#stream(descriptor, model, context, options, hooks);
  }

  async #stream(
    descriptor: EffectiveModelExecutionDescriptor,
    model: Parameters<PiDispatchAwareStreamFunction>[0],
    context: Parameters<PiDispatchAwareStreamFunction>[1],
    sourceOptions: Parameters<PiDispatchAwareStreamFunction>[2],
    hooks: Parameters<PiDispatchAwareStreamFunction>[3],
  ): Promise<AssistantMessageEventStream> {
    const state: DispatchState = {};
    const targetModel = createPiExecutionModel(descriptor, model);
    let stream: AssistantMessageEventStream;
    try {
      const options = await this.#resolveExecutionOptions(
        descriptor,
        sourceOptions,
        hooks,
        state,
      );
      stream = this.#dispatcher.stream(
        descriptor.api as SupportedPiExecutionApi,
        targetModel,
        context,
        options,
      );
    } catch (error) {
      await hooks.onFailedBeforeDispatch(undefined);
      return createFailureStream(
        classifyProviderFailure({ message: errorMessageOf(error), status: state.status }),
        descriptor.api,
      );
    }
    return this.#normalize(stream, state, hooks, descriptor.api);
  }

  async #resolveExecutionOptions(
    descriptor: EffectiveModelExecutionDescriptor,
    sourceOptions: Parameters<PiDispatchAwareStreamFunction>[2],
    hooks: Parameters<PiDispatchAwareStreamFunction>[3],
    state: DispatchState,
  ): Promise<SimpleStreamOptions> {
    const base: SimpleStreamOptions = {
      ...(sourceOptions ?? {}),
      ...(descriptor.parameters.temperature !== undefined
        ? { temperature: descriptor.parameters.temperature }
        : {}),
      ...(descriptor.parameters.maximumOutputTokens !== undefined
        ? { maxTokens: descriptor.parameters.maximumOutputTokens }
        : {}),
      ...(descriptor.parameters.topP !== undefined
        ? { topP: descriptor.parameters.topP }
        : {}),
      ...(descriptor.parameters.seed !== undefined
        ? { seed: descriptor.parameters.seed }
        : {}),
      headers: { ...descriptor.publicHeaders },
      onResponse: async (response) => {
        state.status = response.status;
        await hooks.onDispatched(new Date().toISOString());
      },
    };
    if (descriptor.credentialReference === undefined) {
      return this.#resolveNamedSecretHeaders(descriptor, base);
    }
    return this.#credentials.use(
      descriptor.credentialReference,
      async (secret) =>
        this.#resolveNamedSecretHeaders(descriptor, {
          ...base,
          apiKey: secret,
        }),
    );
  }

  async #resolveNamedSecretHeaders(
    descriptor: EffectiveModelExecutionDescriptor,
    options: SimpleStreamOptions,
  ): Promise<SimpleStreamOptions> {
    const names = Object.keys(descriptor.secretHeaderCredentialReferences);
    let headers = options.headers;
    for (const name of names) {
      const reference = descriptor.secretHeaderCredentialReferences[name];
      if (reference === undefined) continue;
      headers = await this.#credentials.use(reference, async (secret) => ({
        ...headers,
        [name]: secret,
      }));
    }
    return { ...options, headers };
  }

  async #normalize(
    source: AssistantMessageEventStream,
    state: DispatchState,
    hooks: Parameters<PiDispatchAwareStreamFunction>[3],
    api: string,
  ): Promise<AssistantMessageEventStream> {
    const output = new BufferedAssistantMessageEventStream();
    let dispatched = false;
    const markDispatched = (): void => {
      if (!dispatched) {
        dispatched = true;
        void hooks.onDispatched(new Date().toISOString());
      }
    };
    try {
      for await (const event of source) {
        markDispatched();
        if (event.type === "error") {
          const failure =
            event.error.stopReason === "aborted"
              ? PI_PROVIDER_EXECUTION_FAILURE.cancellation
              : classifyProviderFailure({
                  message: event.error.errorMessage,
                  status: state.status,
                });
          this.#logger.info("pi_provider_execution.failed", { failure });
          const normalized = normalizeErrorEvent(event, failure);
          output.push(normalized);
          output.end(normalized.error);
          return asPiStream(output);
        }
        output.push(event);
        if (event.type === "done") {
          output.end(event.message);
          return asPiStream(output);
        }
      }
      output.end();
      return asPiStream(output);
    } catch (error) {
      markDispatched();
      const failure = classifyProviderFailure({
        message: errorMessageOf(error),
        status: state.status,
      });
      this.#logger.info("pi_provider_execution.failed", { failure });
      const message = createErrorAssistantMessage(failure, api);
      const event: AssistantMessageEvent = {
        type: "error",
        reason: "error",
        error: message,
      };
      output.push(event);
      output.end(message);
      return asPiStream(output);
    }
  }
}

export function createPiExecutionModel(
  descriptor: EffectiveModelExecutionDescriptor,
  source: Model<Api>,
): Model<Api> {
  const provider =
    descriptor.providerKind === "openai_compatible" ||
    descriptor.providerKind === "custom"
      ? "openai"
      : descriptor.providerKind;
  return {
    ...source,
    id: descriptor.modelId,
    name: source.name ?? descriptor.modelId,
    api: descriptor.api as Api,
    provider,
    baseUrl: descriptor.baseUrl ?? source.baseUrl,
    headers: { ...source.headers, ...descriptor.publicHeaders },
  };
}

export function classifyProviderFailure(input: {
  readonly message?: string;
  readonly status?: number;
}): PiProviderExecutionFailure {
  const status = input.status;
  if (status !== undefined) {
    if (status === 401 || status === 403) {
      return PI_PROVIDER_EXECUTION_FAILURE.auth;
    }
    if (status === 429) {
      return PI_PROVIDER_EXECUTION_FAILURE.rateLimit;
    }
    if (status === 408 || status === 504) {
      return PI_PROVIDER_EXECUTION_FAILURE.timeout;
    }
    if (status >= 400) {
      return PI_PROVIDER_EXECUTION_FAILURE.response;
    }
  }
  const message = input.message ?? "";
  if (/abort|cancel/i.test(message)) {
    return PI_PROVIDER_EXECUTION_FAILURE.cancellation;
  }
  if (/(timed?\s?out|ETIMEDOUT|timeout|HTTP\s+(408|504))/i.test(message)) {
    return PI_PROVIDER_EXECUTION_FAILURE.timeout;
  }
  if (/rate\s?limit|429/i.test(message)) {
    return PI_PROVIDER_EXECUTION_FAILURE.rateLimit;
  }
  if (/unauthorized|authentication|invalid\s?api|401|403/i.test(message)) {
    return PI_PROVIDER_EXECUTION_FAILURE.auth;
  }
  if (/HTTP\s+[45]\d{2}/i.test(message)) {
    return PI_PROVIDER_EXECUTION_FAILURE.response;
  }
  return PI_PROVIDER_EXECUTION_FAILURE.network;
}

function createUnsupportedStreamFunction(
  logger: Logger,
): PiDispatchAwareStreamFunction {
  return async (_model, _context, _options, hooks) => {
    await hooks.onFailedBeforeDispatch(undefined);
    logger.info("pi_provider_execution.unsupported_api", {
      failure: PI_PROVIDER_EXECUTION_FAILURE.unsupportedApi,
    });
    return createFailureStream(
      PI_PROVIDER_EXECUTION_FAILURE.unsupportedApi,
      "unsupported",
    );
  };
}

function createFailureStream(
  failure: PiProviderExecutionFailure,
  api: string,
): AssistantMessageEventStream {
  const stream = new BufferedAssistantMessageEventStream();
  const message = createErrorAssistantMessage(failure, api);
  const event: AssistantMessageEvent = {
    type: "error",
    reason: "error",
    error: message,
  };
  stream.push(event);
  stream.end(message);
  return asPiStream(stream);
}

function normalizeErrorEvent(
  event: Extract<AssistantMessageEvent, { type: "error" }>,
  failure: PiProviderExecutionFailure,
): Extract<AssistantMessageEvent, { type: "error" }> {
  return {
    ...event,
    error: { ...event.error, errorMessage: failure },
  };
}

export function createErrorAssistantMessage(
  failure: PiProviderExecutionFailure,
  api: string,
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: api as Api,
    provider: "pi",
    model: "pi-provider",
    usage: EMPTY_USAGE,
    stopReason: "error" satisfies StopReason,
    errorMessage: failure,
    timestamp: Date.now(),
  };
}

const EMPTY_USAGE: Usage = Object.freeze({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }),
});

function errorMessageOf(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  return undefined;
}

/** Buffered Pi event stream satisfying the AssistantMessageEventStream surface. */
class BufferedAssistantMessageEventStream {
  readonly #events: AssistantMessageEvent[] = [];
  readonly #resolvers: Array<() => void> = [];
  #result?: AssistantMessage;
  #ended = false;

  push(event: AssistantMessageEvent): void {
    this.#events.push(event);
    this.#flush();
  }

  end(result?: AssistantMessage): void {
    this.#result = result;
    this.#ended = true;
    this.#flush();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent> {
    let index = 0;
    while (true) {
      while (index < this.#events.length) {
        yield this.#events[index]!;
        index += 1;
      }
      if (this.#ended) return;
      await new Promise<void>((resolve) => this.#resolvers.push(resolve));
    }
  }

  async result(): Promise<AssistantMessage> {
    while (!this.#ended) {
      await new Promise<void>((resolve) => this.#resolvers.push(resolve));
    }
    if (this.#result === undefined) {
      throw new Error("Pi Provider event stream ended without a result");
    }
    return this.#result;
  }

  #flush(): void {
    const resolvers = this.#resolvers.splice(0);
    for (const resolve of resolvers) resolve();
  }
}

function asPiStream(
  stream: BufferedAssistantMessageEventStream,
): AssistantMessageEventStream {
  return stream as unknown as AssistantMessageEventStream;
}
