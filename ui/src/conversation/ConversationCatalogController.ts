/** Loads, creates, and selects Workspace Conversations through the shared API. */
import {
  noopLogger,
  type ConversationSnapshot,
  type Logger,
  type NovelApiClient,
} from "@novel/core";

export const DEFAULT_NOVEL_AGENT_BINDING = Object.freeze({
  agentType: "novel_agent",
  definitionVersion: "1.0.0",
});

export type ConversationCatalogPhase =
  | "idle"
  | "loading"
  | "ready"
  | "creating"
  | "error";

export interface ConversationCatalogItem {
  readonly id: string;
  readonly title: string;
  readonly agentType: string;
  readonly agentLabel: string;
}

export interface ConversationCatalogControllerSnapshot {
  readonly revision: number;
  readonly phase: ConversationCatalogPhase;
  readonly workspaceId?: string;
  readonly activeConversationId?: string;
  readonly conversations: readonly ConversationCatalogItem[];
  readonly errorCode?: string;
}

export class ConversationCatalogController {
  private readonly api: NovelApiClient;
  private readonly logger: Logger;
  private readonly listeners = new Set<() => void>();
  private revision = 0;
  private generation = 0;
  private operationTail: Promise<void> = Promise.resolve();
  private snapshot: ConversationCatalogControllerSnapshot = freezeSnapshot({
    revision: 0,
    phase: "idle",
    conversations: Object.freeze([]),
  });

  constructor(options: { readonly api: NovelApiClient; readonly logger?: Logger }) {
    this.api = options.api;
    this.logger = (options.logger ?? noopLogger).child({
      component: "conversation_catalog_controller",
    });
  }

  getSnapshot(): ConversationCatalogControllerSnapshot {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  openWorkspace(workspaceId: string): Promise<ConversationCatalogItem | undefined> {
    const capturedWorkspaceId = requireNonBlank(workspaceId, "Workspace id");
    const generation = ++this.generation;
    this.publish({
      phase: "loading",
      workspaceId: capturedWorkspaceId,
      conversations: Object.freeze([]),
    });
    return this.serialize(async () => {
      this.logger.info("conversation_catalog_ui.load_started");
      try {
        const listed = await this.api.conversations.list({ status: "active" });
        let conversations = [...listed.conversations];
        if (conversations.length === 0) {
          const created = await this.api.conversations.create({
            agent: DEFAULT_NOVEL_AGENT_BINDING,
          });
          try {
            conversations = [await created.getSnapshot()];
          } finally {
            await created.close();
          }
        }
        const items = captureCatalogItems(capturedWorkspaceId, conversations);
        if (generation !== this.generation) return undefined;
        const active = items[0];
        this.publish({
          phase: "ready",
          workspaceId: capturedWorkspaceId,
          conversations: items,
          ...(active !== undefined ? { activeConversationId: active.id } : {}),
        });
        this.logger.info("conversation_catalog_ui.load_completed", {
          conversationCount: items.length,
        });
        return active;
      } catch {
        if (generation === this.generation) {
          this.publish({
            phase: "error",
            workspaceId: capturedWorkspaceId,
            conversations: Object.freeze([]),
            errorCode: "NOVEL_UI_CONVERSATION_CATALOG_LOAD_FAILED",
          });
        }
        this.logger.warn("conversation_catalog_ui.load_failed");
        return undefined;
      }
    });
  }

  createConversation(): Promise<ConversationCatalogItem | undefined> {
    return this.serialize(async () => {
      const workspaceId = this.snapshot.workspaceId;
      if (workspaceId === undefined) return undefined;
      const generation = this.generation;
      this.publishFromCurrent({ phase: "creating", errorCode: undefined });
      this.logger.info("conversation_catalog_ui.create_started");
      try {
        const conversation = await this.api.conversations.create({
          agent: DEFAULT_NOVEL_AGENT_BINDING,
        });
        let createdSnapshot: ConversationSnapshot;
        try {
          createdSnapshot = await conversation.getSnapshot();
        } finally {
          await conversation.close();
        }
        const item = captureCatalogItem(workspaceId, createdSnapshot);
        if (generation !== this.generation) return undefined;
        this.publish({
          phase: "ready",
          workspaceId,
          activeConversationId: item.id,
          conversations: Object.freeze([
            item,
            ...this.snapshot.conversations.filter(
              (conversationItem) => conversationItem.id !== item.id,
            ),
          ]),
        });
        this.logger.info("conversation_catalog_ui.create_completed", {
          conversationCount: this.snapshot.conversations.length,
        });
        return item;
      } catch {
        if (generation === this.generation) {
          this.publishFromCurrent({
            phase: "error",
            errorCode: "NOVEL_UI_CONVERSATION_CREATE_FAILED",
          });
        }
        this.logger.warn("conversation_catalog_ui.create_failed");
        return undefined;
      }
    });
  }

  selectConversation(conversationId: string): ConversationCatalogItem | undefined {
    const capturedId = requireNonBlank(conversationId, "Conversation id");
    const selected = this.snapshot.conversations.find(
      (conversation) => conversation.id === capturedId,
    );
    if (selected === undefined) return undefined;
    this.publishFromCurrent({
      phase: "ready",
      activeConversationId: selected.id,
      errorCode: undefined,
    });
    return selected;
  }

  clearWorkspace(): void {
    this.generation += 1;
    this.publish({
      phase: "idle",
      conversations: Object.freeze([]),
    });
  }

  private serialize<TValue>(operation: () => Promise<TValue>): Promise<TValue> {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private publishFromCurrent(
    update: Partial<
      Pick<
        ConversationCatalogControllerSnapshot,
        "phase" | "activeConversationId" | "errorCode"
      >
    >,
  ): void {
    this.publish({
      phase: update.phase ?? this.snapshot.phase,
      ...(this.snapshot.workspaceId !== undefined
        ? { workspaceId: this.snapshot.workspaceId }
        : {}),
      ...(update.activeConversationId !== undefined
        ? { activeConversationId: update.activeConversationId }
        : "activeConversationId" in update
          ? {}
          : this.snapshot.activeConversationId !== undefined
            ? { activeConversationId: this.snapshot.activeConversationId }
            : {}),
      conversations: this.snapshot.conversations,
      ...(update.errorCode !== undefined
        ? { errorCode: update.errorCode }
        : "errorCode" in update
          ? {}
          : this.snapshot.errorCode !== undefined
            ? { errorCode: this.snapshot.errorCode }
            : {}),
    });
  }

  private publish(
    state: Omit<ConversationCatalogControllerSnapshot, "revision">,
  ): void {
    this.revision += 1;
    this.snapshot = freezeSnapshot({ revision: this.revision, ...state });
    for (const listener of [...this.listeners]) listener();
  }
}

function captureCatalogItems(
  workspaceId: string,
  snapshots: readonly ConversationSnapshot[],
): readonly ConversationCatalogItem[] {
  return Object.freeze(
    [...snapshots]
      .sort((left, right) =>
        right.metadata.updatedAt.localeCompare(left.metadata.updatedAt),
      )
      .map((snapshot) => captureCatalogItem(workspaceId, snapshot)),
  );
}

function captureCatalogItem(
  workspaceId: string,
  snapshot: ConversationSnapshot,
): ConversationCatalogItem {
  if (snapshot.metadata.workspaceId !== workspaceId) {
    throw new TypeError("Conversation Workspace identity is invalid");
  }
  const id = requireNonBlank(snapshot.metadata.id, "Conversation id");
  const agentType = requireNonBlank(
    snapshot.activeAgentBinding.agentType,
    "Agent type",
  );
  return Object.freeze({
    id,
    title: `对话 ${id.slice(-6)}`,
    agentType,
    agentLabel: agentType === "novel_agent" ? "Novel Agent" : agentType,
  });
}

function freezeSnapshot(
  snapshot: ConversationCatalogControllerSnapshot,
): ConversationCatalogControllerSnapshot {
  return Object.freeze({
    ...snapshot,
    conversations: Object.freeze(
      snapshot.conversations.map((conversation) =>
        Object.freeze({ ...conversation }),
      ),
    ),
  });
}

function requireNonBlank(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must not be blank`);
  }
  return value;
}
