/**
 * Routes Core Stop and ReloadConfig inputs without claiming semantic completion.
 *
 * Online Runtimes receive only a durable Journal reference. Offline Stop is a
 * no-op routing result, while offline ReloadConfig is explicitly deferred.
 */
import {
  HOST_INPUT_HANDLER,
  HOST_INPUT_ROUTING_OUTCOME,
  HostInputRoutedOutputEvent,
  INPUT_EVENT_TYPE,
  type HostInputHandler,
  type HostInputRoutingOutcome,
} from "../../event/index.js";
import { noopLogger, type Logger } from "../../observability/index.js";
import type { AcceptedConversationInputSignal } from "../command/index.js";
import type { ConversationOutputEventPublisher } from "../output/index.js";
import {
  SystemConversationHostClock,
  type ConversationHostClock,
} from "./ConversationHostClock.js";
import type {
  ConversationHostControlDispatchContext,
  ConversationHostControlDispatcher,
  ConversationHostControlDispatchResult,
} from "./ConversationHostControlDispatcher.js";
import {
  ConversationHostSignalInvalidError,
  ConversationRuntimeDispatchError,
} from "./ConversationHostErrors.js";
import type { ConversationRuntimeInputReference } from "./ConversationRuntimeInputReference.js";

export interface CoreConversationHostControlDispatcherOptions {
  outputPublisher: ConversationOutputEventPublisher;
  clock?: ConversationHostClock;
  logger?: Logger;
}

export class CoreConversationHostControlDispatcher
  implements ConversationHostControlDispatcher
{
  private readonly outputPublisher: ConversationOutputEventPublisher;
  private readonly clock: ConversationHostClock;
  private readonly logger: Logger;

  constructor(options: CoreConversationHostControlDispatcherOptions) {
    this.outputPublisher = options.outputPublisher;
    this.clock = options.clock ?? new SystemConversationHostClock();
    this.logger = (options.logger ?? noopLogger).child({
      component: "core_conversation_host_control_dispatcher",
    });
  }

  async dispatch(
    signal: AcceptedConversationInputSignal,
    context: ConversationHostControlDispatchContext,
  ): Promise<ConversationHostControlDispatchResult> {
    const handler = validateCoreControlSignal(signal);
    validateContext(signal.conversationId, context);
    this.logger.debug("conversation_host.control.route_started", {
      conversationId: signal.conversationId,
      inputEventId: signal.inputEventId,
      eventType: signal.eventType,
      sequence: signal.sequence,
      handler,
      runtimeOnline: context.runtime !== undefined,
    });

    const outcome = await this.routeRuntimeReference(signal, handler, context);
    const output = new HostInputRoutedOutputEvent({
      conversationId: signal.conversationId,
      timestamp: this.clock.now(),
      inputEvent: {
        id: signal.inputEventId,
        eventType: signal.eventType,
        sequence: signal.sequence,
      },
      handler,
      outcome,
      ...(signal.correlationId !== undefined
        ? { correlationId: signal.correlationId }
        : {}),
      ...(signal.runId !== undefined ? { runId: signal.runId } : {}),
      ...(signal.turnId !== undefined ? { turnId: signal.turnId } : {}),
    });

    try {
      const outputReceipt = await this.outputPublisher.publish(output);
      this.logger.debug("conversation_host.control.routing_output_published", {
        conversationId: signal.conversationId,
        inputEventId: signal.inputEventId,
        eventType: signal.eventType,
        sequence: signal.sequence,
        handler,
        routingOutcome: outcome,
        outputEventId: output.id,
        outputStatus: outputReceipt.status,
        outputSequence: outputReceipt.sequence,
      });
      return Object.freeze({ handler, outcome, outputReceipt });
    } catch (error) {
      this.logger.warn("conversation_host.control.routing_output_failed", {
        conversationId: signal.conversationId,
        inputEventId: signal.inputEventId,
        eventType: signal.eventType,
        sequence: signal.sequence,
        handler,
        routingOutcome: outcome,
        outputEventId: output.id,
        ...getErrorIdentity(error),
      });
      throw error;
    }
  }

  private async routeRuntimeReference(
    signal: AcceptedConversationInputSignal,
    handler: HostInputHandler,
    context: ConversationHostControlDispatchContext,
  ): Promise<HostInputRoutingOutcome> {
    if (context.runtime === undefined) {
      const outcome =
        handler === HOST_INPUT_HANDLER.reloadConfig
          ? HOST_INPUT_ROUTING_OUTCOME.deferred
          : HOST_INPUT_ROUTING_OUTCOME.noRuntime;
      this.logger.info(`conversation_host.control.${outcome}`, {
        conversationId: signal.conversationId,
        inputEventId: signal.inputEventId,
        eventType: signal.eventType,
        sequence: signal.sequence,
        handler,
      });
      return outcome;
    }

    const input = toRuntimeInputReference(signal);
    try {
      await context.runtime.dispatchInput(input);
      this.logger.info("conversation_host.control.runtime_notified", {
        conversationId: signal.conversationId,
        runtimeInstanceId: context.runtime.runtimeInstanceId,
        inputEventId: signal.inputEventId,
        eventType: signal.eventType,
        sequence: signal.sequence,
        handler,
      });
      return HOST_INPUT_ROUTING_OUTCOME.runtimeNotified;
    } catch (error) {
      const identity = getErrorIdentity(error);
      this.logger.warn("conversation_host.control.runtime_notification_failed", {
        conversationId: signal.conversationId,
        runtimeInstanceId: context.runtime.runtimeInstanceId,
        inputEventId: signal.inputEventId,
        eventType: signal.eventType,
        sequence: signal.sequence,
        handler,
        ...identity,
      });
      throw new ConversationRuntimeDispatchError(
        signal.conversationId,
        signal.sequence,
        identity.errorName,
        identity.errorCode,
      );
    }
  }
}

function validateCoreControlSignal(
  signal: AcceptedConversationInputSignal,
): HostInputHandler {
  if (signal.route.target !== "host") {
    throw new ConversationHostSignalInvalidError("route.target");
  }
  if (signal.route.runtimeNotification !== "if_online") {
    throw new ConversationHostSignalInvalidError("route.runtimeNotification");
  }
  if (
    signal.route.handler === HOST_INPUT_HANDLER.stop &&
    signal.eventType === INPUT_EVENT_TYPE.systemStop
  ) {
    return HOST_INPUT_HANDLER.stop;
  }
  if (
    signal.route.handler === HOST_INPUT_HANDLER.reloadConfig &&
    signal.eventType === INPUT_EVENT_TYPE.reloadConfig
  ) {
    return HOST_INPUT_HANDLER.reloadConfig;
  }
  throw new ConversationHostSignalInvalidError("route.handler");
}

function validateContext(
  conversationId: string,
  context: ConversationHostControlDispatchContext,
): void {
  if (context.runtime === undefined) {
    if (context.presence.state === "online") {
      throw new ConversationHostSignalInvalidError("context.runtime");
    }
    return;
  }
  if (
    context.presence.state !== "online" ||
    context.runtime.conversationId !== conversationId ||
    context.runtime.runtimeInstanceId.trim().length === 0
  ) {
    throw new ConversationHostSignalInvalidError("context.runtime");
  }
}

function toRuntimeInputReference(
  signal: AcceptedConversationInputSignal,
): ConversationRuntimeInputReference {
  return Object.freeze({
    conversationId: signal.conversationId,
    inputEventId: signal.inputEventId,
    eventType: signal.eventType,
    sequence: signal.sequence,
    ...(signal.correlationId !== undefined
      ? { correlationId: signal.correlationId }
      : {}),
    ...(signal.runId !== undefined ? { runId: signal.runId } : {}),
    ...(signal.turnId !== undefined ? { turnId: signal.turnId } : {}),
  });
}

function getErrorIdentity(error: unknown): Readonly<{
  errorName: string;
  errorCode?: string;
}> {
  if (error === null || typeof error !== "object") {
    return { errorName: "UnknownError" };
  }
  const candidate = error as { name?: unknown; code?: unknown };
  const errorName =
    typeof candidate.name === "string" && candidate.name.trim().length > 0
      ? candidate.name
      : "UnknownError";
  return typeof candidate.code === "string" && candidate.code.trim().length > 0
    ? { errorName, errorCode: candidate.code }
    : { errorName };
}
