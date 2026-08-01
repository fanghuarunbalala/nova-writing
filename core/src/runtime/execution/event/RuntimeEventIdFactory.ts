/** Creates retry-stable Runtime OutputEvent IDs without hashing Event payloads. */
import {
  canonicalStringifyJson,
  isEventType,
  type JsonObject,
} from "../../../event/protocol/index.js";

export interface RuntimeEventIdHasher {
  readonly algorithm: "sha256";

  digest(canonicalIdentity: string): string;
}

interface CreateRuntimeEventIdBase {
  conversationId: string;
  eventType: string;
  ordinal: number;
}

export type CreateRuntimeEventIdInput = CreateRuntimeEventIdBase &
  (
    | {
        scope: "input";
        inputEventId: string;
      }
    | {
        scope: "run";
        runId: string;
      }
    | {
        scope: "turn";
        runId: string;
        turnId: string;
      }
  );

export interface RuntimeEventIdFactory {
  create(input: CreateRuntimeEventIdInput): string;
}

export interface Sha256RuntimeEventIdFactoryOptions {
  hasher: RuntimeEventIdHasher;
}

export class Sha256RuntimeEventIdFactory implements RuntimeEventIdFactory {
  private readonly hasher: RuntimeEventIdHasher;

  constructor(options: Sha256RuntimeEventIdFactoryOptions) {
    if (options.hasher.algorithm !== "sha256") {
      throw new TypeError("Runtime Event ID factory requires SHA-256");
    }
    this.hasher = options.hasher;
  }

  create(input: CreateRuntimeEventIdInput): string {
    assertNonBlank("Conversation ID", input.conversationId);
    if (!isEventType(input.eventType)) {
      throw new TypeError("Runtime Event type must be valid");
    }
    assertNonNegativeInteger("Runtime Event ordinal", input.ordinal);

    const identity = captureIdentity(input);
    const digest = this.hasher.digest(canonicalStringifyJson(identity));
    if (!/^[a-f0-9]{64}$/.test(digest)) {
      throw new TypeError("Runtime Event ID hasher must return a lowercase SHA-256 digest");
    }
    return `evt_rt_${digest}`;
  }
}

function captureIdentity(input: CreateRuntimeEventIdInput): JsonObject {
  const base: JsonObject = {
    namespace: "novel.runtime-event.v1",
    conversationId: input.conversationId,
    eventType: input.eventType,
    scope: input.scope,
    ordinal: input.ordinal,
  };

  if (input.scope === "input") {
    assertNonBlank("Input Event ID", input.inputEventId);
    return {
      ...base,
      inputEventId: input.inputEventId,
    };
  }
  if (input.scope === "run") {
    assertNonBlank("Run ID", input.runId);
    return {
      ...base,
      runId: input.runId,
    };
  }

  assertNonBlank("Run ID", input.runId);
  assertNonBlank("Turn ID", input.turnId);
  return {
    ...base,
    runId: input.runId,
    turnId: input.turnId,
  };
}

function assertNonBlank(label: string, value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must not be blank`);
  }
}

function assertNonNegativeInteger(label: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
}
