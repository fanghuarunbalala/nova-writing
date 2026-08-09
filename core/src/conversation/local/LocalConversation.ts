/**
 * In-process Conversation Handle composed from platform-neutral service ports.
 * It owns only Handle-local subscriptions, never shared Storage or Host services.
 */
import { noopLogger, type Logger } from "../../observability/index.js";
import type { Conversation } from "../Conversation.js";
import type { ConversationCommandService } from "../ConversationCommandService.js";
import {
  ConversationHandleClosedError,
  ConversationHandleClosingError,
} from "../ConversationErrors.js";
import type { ConversationQueryService } from "../ConversationQueryService.js";
import type { ConversationComposeStateReader } from "../ConversationComposeStateReader.js";
import type { ConversationRuntimePresenceReader } from "../ConversationRuntimePresenceReader.js";
import type { ConversationSnapshot } from "../ConversationSnapshot.js";
import type { RuntimePresence } from "../RuntimePresence.js";
import type { ConversationComposeState } from "../../storage/index.js";
import { LocalConversationEvents } from "./LocalConversationEvents.js";
import { LocalConversationInput } from "./LocalConversationInput.js";

type LocalConversationState = "open" | "closing" | "closed";

export interface LocalConversationOptions {
  snapshot: ConversationSnapshot;
  queryService: ConversationQueryService;
  commandService: ConversationCommandService;
  runtimePresenceReader: ConversationRuntimePresenceReader;
  /** 可选 compose 会话子状态读取器；缺省时 getComposeState 返回 undefined。 */
  /** Optional compose session sub-state reader; getComposeState returns undefined when absent. */
  composeStateReader?: ConversationComposeStateReader;
  logger?: Logger;
}

export class LocalConversation implements Conversation {
  readonly id: string;
  readonly parentConversationId?: string;
  readonly input: LocalConversationInput;
  readonly events: LocalConversationEvents;

  private readonly queryService: ConversationQueryService;
  private readonly runtimePresenceReader: ConversationRuntimePresenceReader;
  private readonly composeStateReader?: ConversationComposeStateReader;
  private readonly logger: Logger;
  private handleState: LocalConversationState = "open";
  private closePromise?: Promise<void>;

  constructor(options: LocalConversationOptions) {
    this.id = options.snapshot.metadata.id;
    this.parentConversationId = options.snapshot.metadata.parentConversationId;
    this.queryService = options.queryService;
    this.runtimePresenceReader = options.runtimePresenceReader;
    this.composeStateReader = options.composeStateReader;
    this.logger = (options.logger ?? noopLogger).child({
      component: "local_conversation",
      conversationId: this.id,
    });
    const assertHandleOpen = (): void => this.assertOpen();
    this.input = new LocalConversationInput({
      conversationId: this.id,
      commandService: options.commandService,
      assertHandleOpen,
    });
    this.events = new LocalConversationEvents({
      conversationId: this.id,
      queryService: options.queryService,
      assertHandleOpen,
      logger: this.logger,
    });
    this.logger.debug("conversation.handle.created", {
      ...(this.parentConversationId !== undefined
        ? { parentConversationId: this.parentConversationId }
        : {}),
    });
  }

  getSnapshot(): Promise<ConversationSnapshot> {
    this.assertOpen();
    return this.queryService.getSnapshot(this.id);
  }

  getRuntimePresence(): Promise<RuntimePresence> {
    this.assertOpen();
    return this.runtimePresenceReader.getRuntimePresence(this.id);
  }

  getComposeState(): Promise<ConversationComposeState | undefined> {
    this.assertOpen();
    if (this.composeStateReader === undefined) {
      return Promise.resolve(undefined);
    }
    return this.composeStateReader.getConversationComposeState(this.id);
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeOnce();
    return this.closePromise;
  }

  private async closeOnce(): Promise<void> {
    this.handleState = "closing";
    this.logger.info("conversation.handle.close_started");
    try {
      await this.events.closeSubscriptions();
      this.logger.info("conversation.handle.close_completed");
    } catch (error) {
      this.logger.error("conversation.handle.close_failed", {
        errorName: getErrorName(error),
      });
      throw error;
    } finally {
      this.handleState = "closed";
    }
  }

  private assertOpen(): void {
    if (this.handleState === "closing") {
      throw new ConversationHandleClosingError(this.id);
    }
    if (this.handleState === "closed") {
      throw new ConversationHandleClosedError(this.id);
    }
  }
}

function getErrorName(error: unknown): string {
  if (error === null || typeof error !== "object") return "UnknownError";
  const name = (error as { name?: unknown }).name;
  return typeof name === "string" && name.trim().length > 0 ? name : "UnknownError";
}
