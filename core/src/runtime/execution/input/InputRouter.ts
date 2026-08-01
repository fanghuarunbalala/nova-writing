/** Routes validated Journal Inputs into preemptive Control and FIFO Turn inboxes. */
import {
  canonicalStringifyJson,
  type JsonValue,
} from "../../../event/protocol/index.js";
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { PersistedInputEventSnapshot } from "../../../storage/journal/PersistedConversationEventSnapshot.js";
import {
  RuntimeInputConflictError,
  RuntimeInputRejectedError,
} from "./RuntimeInputErrors.js";
import { RuntimeInputInbox } from "./RuntimeInputInbox.js";
import {
  CoreRuntimeInputLanePolicy,
  RUNTIME_INPUT_LANE,
  type RuntimeInputLane,
  type RuntimeInputLanePolicy,
} from "./RuntimeInputLanePolicy.js";

const DEFAULT_CONTROL_CAPACITY = 64;
const DEFAULT_TURN_CAPACITY = 1024;

export const RUNTIME_INPUT_ROUTE_STATUS = {
  enqueued: "enqueued",
  duplicate: "duplicate",
} as const;

export type RuntimeInputRouteStatus =
  (typeof RUNTIME_INPUT_ROUTE_STATUS)[keyof typeof RUNTIME_INPUT_ROUTE_STATUS];

export interface RuntimeInputRouteResult {
  readonly status: RuntimeInputRouteStatus;
  readonly lane: RuntimeInputLane;
  readonly sequence: number;
}

export interface InputRouterOptions {
  conversationId: string;
  lanePolicy?: RuntimeInputLanePolicy;
  controlCapacity?: number;
  turnCapacity?: number;
  logger?: Logger;
}

export class InputRouter {
  readonly controlInbox: RuntimeInputInbox;
  readonly turnInbox: RuntimeInputInbox;
  private readonly conversationId: string;
  private readonly lanePolicy: RuntimeInputLanePolicy;
  private readonly logger: Logger;
  private readonly fingerprints = new Map<number, string>();

  constructor(options: InputRouterOptions) {
    assertNonBlank("Conversation ID", options.conversationId);
    this.conversationId = options.conversationId;
    this.lanePolicy = options.lanePolicy ?? new CoreRuntimeInputLanePolicy();
    this.controlInbox = new RuntimeInputInbox(
      RUNTIME_INPUT_LANE.control,
      options.controlCapacity ?? DEFAULT_CONTROL_CAPACITY,
    );
    this.turnInbox = new RuntimeInputInbox(
      RUNTIME_INPUT_LANE.turn,
      options.turnCapacity ?? DEFAULT_TURN_CAPACITY,
    );
    this.logger = (options.logger ?? noopLogger).child({
      component: "runtime_input_router",
      conversationId: this.conversationId,
    });
  }

  route(event: PersistedInputEventSnapshot): RuntimeInputRouteResult {
    const captured = captureInput(event, this.conversationId);
    const fingerprint = canonicalStringifyJson(captured as unknown as JsonValue);
    const existing = this.fingerprints.get(captured.sequence);
    const lane = this.lanePolicy.resolve(captured);
    if (existing !== undefined) {
      if (existing !== fingerprint) {
        throw new RuntimeInputConflictError(this.conversationId, captured.sequence);
      }
      this.logger.debug("runtime.input.route_duplicate", {
        eventId: captured.id,
        eventType: captured.eventType,
        sequence: captured.sequence,
        lane,
      });
      return freezeRouteResult(RUNTIME_INPUT_ROUTE_STATUS.duplicate, lane, captured.sequence);
    }

    const inbox = lane === RUNTIME_INPUT_LANE.control ? this.controlInbox : this.turnInbox;
    inbox.enqueue(captured);
    this.fingerprints.set(captured.sequence, fingerprint);
    this.logger.info("runtime.input.routed", {
      eventId: captured.id,
      eventType: captured.eventType,
      sequence: captured.sequence,
      priority: captured.priority,
      lane,
      controlQueueSize: this.controlInbox.size,
      turnQueueSize: this.turnInbox.size,
    });
    return freezeRouteResult(RUNTIME_INPUT_ROUTE_STATUS.enqueued, lane, captured.sequence);
  }

  peekNext(): PersistedInputEventSnapshot | undefined {
    return this.controlInbox.peek() ?? this.turnInbox.peek();
  }

  dequeueNext(): PersistedInputEventSnapshot | undefined {
    return this.controlInbox.dequeue() ?? this.turnInbox.dequeue();
  }

  applyStopFence(stopSequence: number): readonly PersistedInputEventSnapshot[] {
    if (!Number.isSafeInteger(stopSequence) || stopSequence <= 0) {
      throw new TypeError("Stop fence Sequence must be a positive safe integer");
    }
    const removed = this.turnInbox.removeThrough(stopSequence);
    this.logger.info("runtime.input.stop_fence_applied", {
      stopSequence,
      cancelledInputCount: removed.length,
      controlQueueSize: this.controlInbox.size,
      turnQueueSize: this.turnInbox.size,
    });
    return removed;
  }
}

function captureInput(
  event: PersistedInputEventSnapshot,
  conversationId: string,
): PersistedInputEventSnapshot {
  if (
    event === null ||
    typeof event !== "object" ||
    event.direction !== "input" ||
    !Number.isSafeInteger(event.sequence) ||
    event.sequence <= 0
  ) {
    throw new RuntimeInputRejectedError("invalid_event");
  }
  if (event.conversationId !== conversationId) {
    throw new RuntimeInputRejectedError("conversation_mismatch");
  }
  return deepFreezeJson(
    JSON.parse(canonicalStringifyJson(event as unknown as JsonValue)),
  ) as PersistedInputEventSnapshot;
}

function freezeRouteResult(
  status: RuntimeInputRouteStatus,
  lane: RuntimeInputLane,
  sequence: number,
): RuntimeInputRouteResult {
  return Object.freeze({ status, lane, sequence });
}

function deepFreezeJson<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const child of Object.values(value)) deepFreezeJson(child);
  return Object.freeze(value);
}

function assertNonBlank(label: string, value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must not be blank`);
  }
}
