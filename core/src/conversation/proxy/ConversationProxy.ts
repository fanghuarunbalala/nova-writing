/** Remote-capable Conversation Handle that preserves the local public abstraction. */
import { noopLogger, type Logger } from "../../observability/index.js";
import type { Conversation } from "../Conversation.js";
import {
  ConversationHandleClosedError,
  ConversationHandleClosingError,
} from "../ConversationErrors.js";
import type { ConversationSnapshot } from "../ConversationSnapshot.js";
import type { RuntimePresence } from "../RuntimePresence.js";
import type { ConversationClient } from "../client/index.js";
import { ProxyConversationEvents } from "./ProxyConversationEvents.js";
import { ProxyConversationInput } from "./ProxyConversationInput.js";

type ConversationProxyState = "open" | "closing" | "closed";

export interface ConversationProxyOptions {
  readonly snapshot: ConversationSnapshot;
  readonly client: ConversationClient;
  readonly logger?: Logger;
}

export class ConversationProxy implements Conversation {
  readonly id: string;
  readonly parentConversationId?: string;
  readonly input: ProxyConversationInput;
  readonly events: ProxyConversationEvents;

  private readonly client: ConversationClient;
  private readonly logger: Logger;
  private handleState: ConversationProxyState = "open";
  private closePromise?: Promise<void>;

  constructor(options: ConversationProxyOptions) {
    this.id = options.snapshot.metadata.id;
    this.parentConversationId = options.snapshot.metadata.parentConversationId;
    this.client = options.client;
    this.logger = (options.logger ?? noopLogger).child({
      component: "conversation_proxy",
      conversationId: this.id,
    });
    const assertHandleOpen = (): void => this.assertOpen();
    this.input = new ProxyConversationInput({
      conversationId: this.id,
      client: this.client,
      assertHandleOpen,
    });
    this.events = new ProxyConversationEvents({
      conversationId: this.id,
      client: this.client,
      assertHandleOpen,
      logger: this.logger,
    });
    this.logger.debug("conversation.proxy.created", {
      ...(this.parentConversationId !== undefined
        ? { parentConversationId: this.parentConversationId }
        : {}),
    });
  }

  getSnapshot(): Promise<ConversationSnapshot> {
    this.assertOpen();
    return this.client.getSnapshot(this.id);
  }

  getRuntimePresence(): Promise<RuntimePresence> {
    this.assertOpen();
    return this.client.getRuntimePresence(this.id);
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeOnce();
    return this.closePromise;
  }

  private async closeOnce(): Promise<void> {
    this.handleState = "closing";
    this.logger.info("conversation.proxy.close_started");
    try {
      await this.events.closeSubscriptions();
      this.logger.info("conversation.proxy.close_completed");
    } catch (error) {
      this.logger.error("conversation.proxy.close_failed", {
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
  return typeof name === "string" && name.trim().length > 0
    ? name
    : "UnknownError";
}
