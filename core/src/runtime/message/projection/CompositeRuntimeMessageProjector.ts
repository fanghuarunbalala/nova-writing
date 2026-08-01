/**
 * Runs deterministic projectors in registration order and validates every
 * produced draft before it can reach the Message projection file.
 *
 * @example
 * ```ts
 * const projector = new CompositeRuntimeMessageProjector({
 *   id: "novel.runtime-message",
 *   version: "1",
 *   projectors: [new CoreRuntimeMessageProjector()],
 *   messageSchemaRegistry,
 *   logger,
 * });
 * ```
 */
import { noopLogger, type Logger } from "../../../observability/index.js";
import type { PersistedConversationEventSnapshot } from "../../../storage/index.js";
import type { RuntimeMessageSchemaRegistry } from "../RuntimeMessageSchemaRegistry.js";
import type { RuntimeMessageDraft } from "../RuntimeMessageSnapshot.js";
import { RuntimeMessageProjectionError } from "./RuntimeMessageProjectionError.js";
import type { RuntimeMessageProjector } from "./RuntimeMessageProjector.js";

export interface CompositeRuntimeMessageProjectorOptions {
  id: string;
  version: string;
  projectors: readonly RuntimeMessageProjector[];
  messageSchemaRegistry: RuntimeMessageSchemaRegistry;
  logger?: Logger;
}

export class CompositeRuntimeMessageProjector implements RuntimeMessageProjector {
  readonly id: string;
  readonly version: string;

  private readonly projectors: readonly RuntimeMessageProjector[];
  private readonly messageSchemaRegistry: RuntimeMessageSchemaRegistry;
  private readonly logger: Logger;

  constructor(options: CompositeRuntimeMessageProjectorOptions) {
    this.assertNonBlank("projector id", options.id);
    this.assertNonBlank("projector version", options.version);
    this.assertUniqueProjectors(options.projectors);
    this.id = options.id;
    this.version = options.version;
    this.projectors = [...options.projectors];
    this.messageSchemaRegistry = options.messageSchemaRegistry;
    this.logger = (options.logger ?? noopLogger).child({
      component: "runtime_message_projector",
      projectorId: this.id,
      projectorVersion: this.version,
    });
  }

  project(event: PersistedConversationEventSnapshot): readonly RuntimeMessageDraft[] {
    this.logger.debug("runtime_message_projection.event.started", {
      conversationId: event.conversationId,
      eventId: event.id,
      eventType: event.eventType,
      direction: event.direction,
      sequence: event.sequence,
    });

    const messages: RuntimeMessageDraft[] = [];
    for (const projector of this.projectors) {
      let projected: readonly RuntimeMessageDraft[];
      try {
        projected = projector.project(event);
      } catch (error) {
        throw new RuntimeMessageProjectionError(
          `Runtime message projector failed: ${projector.id}`,
          projector.id,
          event.id,
          { cause: error },
        );
      }

      for (const draft of projected) {
        try {
          messages.push(this.messageSchemaRegistry.validateDraft(draft));
        } catch (error) {
          throw new RuntimeMessageProjectionError(
            `Runtime message projector produced an invalid draft: ${projector.id}`,
            projector.id,
            event.id,
            { cause: error },
          );
        }
      }
    }

    this.logger.debug("runtime_message_projection.event.completed", {
      conversationId: event.conversationId,
      eventId: event.id,
      eventType: event.eventType,
      direction: event.direction,
      sequence: event.sequence,
      messageCount: messages.length,
    });
    return messages;
  }

  private assertUniqueProjectors(projectors: readonly RuntimeMessageProjector[]): void {
    const keys = new Set<string>();
    for (const projector of projectors) {
      this.assertNonBlank("child projector id", projector.id);
      this.assertNonBlank("child projector version", projector.version);
      const key = `${projector.id}@${projector.version}`;
      if (keys.has(key)) {
        throw new TypeError(`Duplicate runtime message projector: ${key}`);
      }
      keys.add(key);
    }
  }

  private assertNonBlank(label: string, value: string): void {
    if (value.trim().length === 0) throw new TypeError(`${label} must not be blank`);
  }
}
