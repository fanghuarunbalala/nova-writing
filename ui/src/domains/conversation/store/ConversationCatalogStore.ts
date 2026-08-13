/**
 * ConversationCatalogStore
 *
 * 管理对话列表的域 store。从 core API 加载对话列表、跟踪 active 对话、
 * 提供 create/select。所有 mutation 经 TaskSerializer 串行。
 *
 * 说明：
 * - 提供 create/select/delete；rename/pin 延后（新 core 无此契约，方法 reject）。
 * - loadWorkspace 只加载不自动创建（spec 1.5.1 语义；空态由 ChatEmptyState 引导）。
 * - ConversationSummary 无 title/updatedAt/pinned，title 取 name、lastActivityAt 置 0。
 */
import type { ConversationSummary, Logger, NovelApiClient } from "@novel/core";
import { noopLogger } from "@novel/core/client";
import { ExternalStore } from "../../../shared/state/ExternalStore.js";
import { TaskSerializer } from "../../../shared/state/TaskSerializer.js";

export type ConversationCatalogPhase = "idle" | "loading" | "ready" | "error";

/** 会话运行状态（供列表标识：生成中 / 失败 / 不可用）。Conversation runtime status for list display. */
export type ConversationCatalogStatus = "generating" | "failed" | "unavailable";

export interface ConversationCatalogItem {
  readonly id: string;
  readonly title: string;
  readonly agentType: string;
  readonly agentLabel: string;
  readonly lastActivityAt: number;
  readonly pinned?: boolean;
  readonly status?: ConversationCatalogStatus;
}

export interface ConversationCatalogError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface ConversationCatalogSnapshot {
  readonly phase: ConversationCatalogPhase;
  readonly workspaceId: string | undefined;
  readonly conversations: readonly ConversationCatalogItem[];
  readonly activeConversationId: string | undefined;
  readonly error: ConversationCatalogError | undefined;
}

const EMPTY_SNAPSHOT: ConversationCatalogSnapshot = Object.freeze({
  phase: "idle",
  workspaceId: undefined,
  conversations: Object.freeze([]),
  activeConversationId: undefined,
  error: undefined,
});

export class ConversationCatalogStore extends ExternalStore<ConversationCatalogSnapshot> {
  private readonly api: NovelApiClient;
  private readonly logger: Logger;
  private readonly serializer = new TaskSerializer();
  private generation = 0;

  constructor(deps: { readonly api: NovelApiClient; readonly logger?: Logger }) {
    super(EMPTY_SNAPSHOT);
    this.api = deps.api;
    this.logger = (deps.logger ?? noopLogger).child({
      component: "conversation_catalog_store",
    });
  }

  /** 加载指定 workspace 的活跃对话列表；完成后 active 指向第一条。 */
  loadWorkspace(workspaceId: string): Promise<void> {
    const capturedId = requireNonBlank(workspaceId, "Workspace id");
    const generation = ++this.generation;
    this.setSnapshot({
      phase: "loading",
      workspaceId: capturedId,
      conversations: Object.freeze([]),
      activeConversationId: undefined,
      error: undefined,
    });
    return this.serializer.run(async () => {
      this.logger.info("conversation_catalog.load_started");
      try {
        const listed = await this.api.conversations.list();
        const items = captureCatalogItems(listed);
        if (generation !== this.generation) return;
        this.setSnapshot({
          phase: "ready",
          workspaceId: capturedId,
          conversations: items,
          activeConversationId: items[0]?.id,
          error: undefined,
        });
        this.logger.info("conversation_catalog.load_completed", {
          conversationCount: items.length,
        });
      } catch {
        if (generation !== this.generation) return;
        this.setSnapshot({
          phase: "error",
          workspaceId: capturedId,
          conversations: Object.freeze([]),
          activeConversationId: undefined,
          error: {
            code: "conversation-load-failed",
            message: "对话列表加载失败，请重试",
            retryable: true,
          },
        });
        this.logger.warn("conversation_catalog.load_failed");
      }
    });
  }

  /** 选中一条对话；id 不存在时为 no-op。 */
  selectConversation(id: string): void {
    const capturedId = requireNonBlank(id, "Conversation id");
    const selected = this.snapshot.conversations.find((item) => item.id === capturedId);
    if (selected === undefined) return;
    this.setSnapshot({ ...this.snapshot, activeConversationId: selected.id, error: undefined });
  }

  /** 新建默认 Agent 对话并置为 active；返回新对话 id，失败时返回空串。 */
  createConversation(): Promise<string> {
    const workspaceId = this.snapshot.workspaceId;
    if (workspaceId === undefined) return Promise.resolve("");
    const generation = this.generation;
    return this.serializer.run(async () => {
      this.logger.info("conversation_catalog.create_started");
      try {
        const ref = await this.api.conversations.create("novel");
        if (generation !== this.generation) return "";
        const item = captureCatalogItem(ref.conversationId);
        this.setSnapshot({
          phase: "ready",
          workspaceId,
          conversations: Object.freeze([
            item,
            ...this.snapshot.conversations.filter((existing) => existing.id !== item.id),
          ]),
          activeConversationId: item.id,
          error: undefined,
        });
        this.logger.info("conversation_catalog.create_completed", {
          conversationCount: this.snapshot.conversations.length,
        });
        return item.id;
      } catch {
        if (generation !== this.generation) return "";
        this.setSnapshot({
          ...this.snapshot,
          phase: "error",
          error: {
            code: "conversation-create-failed",
            message: "新建对话失败，请重试",
            retryable: true,
          },
        });
        this.logger.warn("conversation_catalog.create_failed");
        return "";
      }
    });
  }

  /** 清除 workspace 上下文（workspace 切换/关闭时调用）。 */
  clearWorkspace(): void {
    this.generation += 1;
    this.setSnapshot(EMPTY_SNAPSHOT);
  }

  /** 基于上次失败的 workspace 重试加载。 */
  retry(): Promise<void> {
    const workspaceId = this.snapshot.workspaceId;
    if (workspaceId === undefined) return Promise.resolve();
    return this.loadWorkspace(workspaceId);
  }

  /** 重命名对话（新 core 无契约，延后）。 */
  renameConversation(_id: string, _title: string): Promise<void> {
    return Promise.reject(new Error("rename-not-implemented"));
  }

  /** 置顶/取消置顶（新 core 无契约，延后）。 */
  pinConversation(_id: string, _pinned: boolean): Promise<void> {
    return Promise.reject(new Error("pin-not-implemented"));
  }

  /** 删除对话（软删除）。Deletes a conversation (soft). */
  deleteConversation(id: string): Promise<void> {
    const capturedId = requireNonBlank(id, "Conversation id");
    return this.serializer.run(async () => {
      this.logger.info("conversation_catalog.delete_started");
      try {
        await this.api.conversations.delete(capturedId);
        const conversations = Object.freeze(
          this.snapshot.conversations.filter((item) => item.id !== capturedId),
        );
        this.setSnapshot({
          ...this.snapshot,
          conversations,
          activeConversationId:
            this.snapshot.activeConversationId === capturedId
              ? conversations[0]?.id
              : this.snapshot.activeConversationId,
        });
      } catch {
        this.logger.warn("conversation_catalog.delete_failed");
        throw new Error("delete-failed");
      }
    });
  }
}

function captureCatalogItems(
  summaries: readonly ConversationSummary[],
): readonly ConversationCatalogItem[] {
  return Object.freeze(summaries.map((summary) => captureCatalogItem(summary.conversationId)));
}

function captureCatalogItem(conversationId: string): ConversationCatalogItem {
  const id = requireNonBlank(conversationId, "Conversation id");
  return Object.freeze({
    id,
    title: `对话 ${id.slice(-6)}`,
    agentType: "novel",
    agentLabel: "Novel Agent",
    lastActivityAt: 0,
  });
}

function requireNonBlank(value: string, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} is required`);
  }
  return value;
}
