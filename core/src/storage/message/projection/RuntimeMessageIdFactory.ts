/**
 * Produces stable Runtime Message IDs from projection identity and Journal
 * source identity without including user or model content.
 */
import { canonicalStringifyJson, type JsonObject } from "../../../event/index.js";
import type { MessageProjectionHasher } from "../protocol/index.js";
import type { MessageProjectionIdentity } from "./MessageProjectionIdentity.js";

export interface CreateRuntimeMessageIdInput extends MessageProjectionIdentity {
  conversationId: string;
  eventId: string;
  eventSequence: number;
  ordinal: number;
}

export interface RuntimeMessageIdFactory {
  create(input: CreateRuntimeMessageIdInput): string;
}

export interface Sha256RuntimeMessageIdFactoryOptions {
  hasher: MessageProjectionHasher;
}

export class Sha256RuntimeMessageIdFactory implements RuntimeMessageIdFactory {
  private readonly hasher: MessageProjectionHasher;

  constructor(options: Sha256RuntimeMessageIdFactoryOptions) {
    if (options.hasher.algorithm !== "sha256") {
      throw new TypeError("Runtime Message ID factory requires SHA-256");
    }
    this.hasher = options.hasher;
  }

  create(input: CreateRuntimeMessageIdInput): string {
    this.assertNonBlank("conversationId", input.conversationId);
    this.assertNonBlank("projectorId", input.projectorId);
    this.assertNonBlank("projectorVersion", input.projectorVersion);
    this.assertNonBlank("eventId", input.eventId);
    this.assertPositiveInteger("eventSequence", input.eventSequence);
    this.assertNonNegativeInteger("ordinal", input.ordinal);

    const identity: JsonObject = {
      conversationId: input.conversationId,
      projectorId: input.projectorId,
      projectorVersion: input.projectorVersion,
      eventId: input.eventId,
      eventSequence: input.eventSequence,
      ordinal: input.ordinal,
    };
    const digest = this.hasher.digest(canonicalStringifyJson(identity));
    if (!/^[a-f0-9]{64}$/.test(digest)) {
      throw new TypeError("Runtime Message ID hasher must return a lowercase SHA-256 digest");
    }
    return `msg-${digest}`;
  }

  private assertNonBlank(label: string, value: string): void {
    if (value.trim().length === 0) throw new TypeError(`${label} must not be blank`);
  }

  private assertPositiveInteger(label: string, value: number): void {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`${label} must be a positive safe integer`);
    }
  }

  private assertNonNegativeInteger(label: string, value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`${label} must be a non-negative safe integer`);
    }
  }
}
