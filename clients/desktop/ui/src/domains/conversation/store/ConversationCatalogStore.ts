/**
 * ConversationCatalogStore
 *
 * 管理对话列表的域 store。从 core API 加载对话列表、跟踪 active 对话、
 * 提供 create/select。所有 mutation 经 TaskSerializer 串行。
 *
 * 说明：
 * - 提供 create/select/delete/rename/pin；pin 经 api.conversations.pin 持久化
 *   （core meta.json），重启由 journal mtime / meta 恢复。
 * - lastActivityAt 运行期本地维护（touchActivity），不落盘：journal 每次追加都会
 *   更新 mtime，重启恢复时由 core 以 mtime 为权威来源。
 * - loadWorkspace 只加载不自动创建（spec 1.5.1 语义；空态由 ChatEmptyState 引导）。
 * - 标题来源：summary.name（core 侧为显式名或 journal 首句派生名）；
 *   未命名（name === conversationId）时展示自动格式「对话 + id 尾号」，
 *   活动会话首句到达后经 applyDerivedTitle 即时更新（显式改名不覆盖）。
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
        // 新会话未命名（summary.name = conversationId）→ 自动标题，首句到达后派生
        const item = captureCatalogItem({
          conversationId: ref.conversationId,
          name: ref.conversationId,
          storeDir: "",
          status: "active",
          lastActivityAt: Date.now(),
        });
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

  /**
   * 重命名对话：经 api.conversations.rename 持久化（storedir/meta.json），
   * 成功后本地 patch 标题；失败向上抛（调用方 toast）。
   * @param id 会话 id
   * @param title 新标题（trim 后非空）
   */
  renameConversation(id: string, title: string): Promise<void> {
    const capturedId = requireNonBlank(id, "Conversation id");
    const next = title.trim();
    if (next === "") return Promise.reject(new Error("rename-title-blank"));
    return this.serializer.run(async () => {
      this.logger.info("conversation_catalog.rename_started");
      const hit = await this.api.conversations.rename(capturedId, next);
      if (!hit) throw new Error("rename-not-found");
      const conversations = Object.freeze(
        this.snapshot.conversations.map((item) =>
          item.id === capturedId ? Object.freeze({ ...item, title: next }) : item,
        ),
      );
      this.setSnapshot({ ...this.snapshot, conversations });
      this.logger.info("conversation_catalog.rename_completed");
    });
  }

  /**
   * 首句派生标题：仅当当前标题仍为自动格式时更新（显式改名不覆盖）。
   * @param conversationId 会话 id
   * @param text 首句用户消息（截断 30 字）
   */
  applyDerivedTitle(conversationId: string, text: string): void {
    const capturedId = requireNonBlank(conversationId, "Conversation id");
    const current = this.snapshot.conversations.find((item) => item.id === capturedId);
    if (current === undefined || current.title !== autoTitle(capturedId)) return;
    const derived = truncateConversationTitle(text);
    if (derived === "") return;
    const conversations = Object.freeze(
      this.snapshot.conversations.map((item) =>
        item.id === capturedId ? Object.freeze({ ...item, title: derived }) : item,
      ),
    );
    this.setSnapshot({ ...this.snapshot, conversations });
  }

  /**
   * 置顶/取消置顶对话：经 api.conversations.pin 持久化（storedir/meta.json），
   * 成功后本地 patch pinned；失败向上抛（调用方 toast）。
   * @param id 会话 id
   * @param pinned 是否置顶
   */
  pinConversation(id: string, pinned: boolean): Promise<void> {
    const capturedId = requireNonBlank(id, "Conversation id");
    return this.serializer.run(async () => {
      this.logger.info("conversation_catalog.pin_started");
      const hit = await this.api.conversations.pin(capturedId, pinned);
      if (!hit) throw new Error("pin-not-found");
      const conversations = Object.freeze(
        this.snapshot.conversations.map((item) =>
          item.id === capturedId ? Object.freeze({ ...item, pinned }) : item,
        ),
      );
      this.setSnapshot({ ...this.snapshot, conversations });
      this.logger.info("conversation_catalog.pin_completed");
    });
  }

  /**
   * 刷新会话最后活动时间（本地，不落盘：重启由 core 从 journal mtime 恢复）。
   * 发送消息成功后调用，驱动「今天」分组即时生效。
   * @param id 会话 id
   */
  touchActivity(id: string): void {
    const capturedId = requireNonBlank(id, "Conversation id");
    const hit = this.snapshot.conversations.some((item) => item.id === capturedId);
    if (!hit) return;
    const now = Date.now();
    const conversations = Object.freeze(
      this.snapshot.conversations.map((item) =>
        item.id === capturedId ? Object.freeze({ ...item, lastActivityAt: now }) : item,
      ),
    );
    this.setSnapshot({ ...this.snapshot, conversations });
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

/** 未命名会话的自动标题（name === conversationId 时的展示格式） */
function autoTitle(id: string): string {
  return `对话 ${id.slice(-6)}`;
}

/** 首句派生标题截断：折叠空白、上限 30 字 + 省略号（与 core scanCatalog 派生一致） */
function truncateConversationTitle(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > 30 ? `${collapsed.slice(0, 30)}…` : collapsed;
}

function captureCatalogItems(
  summaries: readonly ConversationSummary[],
): readonly ConversationCatalogItem[] {
  return Object.freeze(summaries.map((summary) => captureCatalogItem(summary)));
}

function captureCatalogItem(summary: ConversationSummary): ConversationCatalogItem {
  const id = requireNonBlank(summary.conversationId, "Conversation id");
  return Object.freeze({
    id,
    title: summary.name !== id ? summary.name : autoTitle(id),
    agentType: "novel",
    agentLabel: "Novel Agent",
    ...(summary.pinned === true ? { pinned: true } : {}),
    lastActivityAt: summary.lastActivityAt ?? 0,
  });
}

function requireNonBlank(value: string, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} is required`);
  }
  return value;
}
