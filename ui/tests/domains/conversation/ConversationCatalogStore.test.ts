/**
 * ConversationCatalogStore 契约测试：load/create/select/clear/retry 与 core API 交互。
 */
import { describe, expect, it, vi } from "vitest";
import type { Conversation, ConversationSnapshot, NovelApiClient } from "@novel/core";
import { ConversationCatalogStore, DEFAULT_NOVEL_AGENT_BINDING } from "../../../src/domains/conversation/store/ConversationCatalogStore.js";

function conversationSnapshot(
  id: string,
  workspaceId: string,
  updatedAt: string,
): ConversationSnapshot {
  return {
    metadata: {
      id,
      workspaceId,
      rootConversationId: id,
      status: "active",
      createdAt: updatedAt,
      updatedAt,
      lastJournalSequence: 0,
    },
    activeAgentBinding: {
      id: `binding-${id}`,
      conversationId: id,
      revision: 1,
      status: "active",
      createdAt: updatedAt,
      agentType: "novel",
      definitionVersion: "1.0.0",
    },
  };
}

function conversationHandle(snapshot: ConversationSnapshot): Conversation {
  return {
    getSnapshot: async () => snapshot,
    close: async () => undefined,
  } as unknown as Conversation;
}

function buildApi(overrides: Partial<NovelApiClient["conversations"]> = {}): NovelApiClient {
  return {
    conversations: {
      list: vi.fn(async () => ({ conversations: [] })),
      create: vi.fn(async () => conversationHandle(conversationSnapshot("conversation_created", "w1", "2026-08-05T09:00:00.000Z"))),
      open: vi.fn(async () => conversationHandle(conversationSnapshot("conversation_open", "w1", "2026-08-05T09:00:00.000Z"))),
      ...overrides,
    },
  } as unknown as NovelApiClient;
}

describe("ConversationCatalogStore", () => {
  it("starts idle with no workspace", () => {
    const api = buildApi();
    const store = new ConversationCatalogStore({ api });
    expect(store.getSnapshot().phase).toBe("idle");
    expect(store.getSnapshot().conversations).toHaveLength(0);
  });

  it("loadWorkspace lists active conversations sorted by updatedAt and selects the newest", async () => {
    const api = buildApi({
      list: vi.fn(async () => ({
        conversations: [
          conversationSnapshot("conversation_old", "w1", "2026-08-05T08:00:00.000Z"),
          conversationSnapshot("conversation_new", "w1", "2026-08-05T09:00:00.000Z"),
        ],
      })),
    });
    const store = new ConversationCatalogStore({ api });
    await store.loadWorkspace("w1");
    const snapshot = store.getSnapshot();
    expect(api.conversations.list).toHaveBeenCalledWith({ status: "active" });
    expect(snapshot.phase).toBe("ready");
    expect(snapshot.workspaceId).toBe("w1");
    expect(snapshot.conversations.map((item) => item.id)).toEqual([
      "conversation_new",
      "conversation_old",
    ]);
    expect(snapshot.activeConversationId).toBe("conversation_new");
    expect(snapshot.conversations[0].agentLabel).toBe("Novel Agent");
  });

  it("records a retryable error when the list fails", async () => {
    const api = buildApi({
      list: vi.fn(async () => {
        throw new Error("network down");
      }),
    });
    const store = new ConversationCatalogStore({ api });
    await store.loadWorkspace("w1");
    expect(store.getSnapshot().phase).toBe("error");
    expect(store.getSnapshot().error?.code).toBe("conversation-load-failed");
    expect(store.getSnapshot().error?.retryable).toBe(true);
  });

  it("retry reloads the last workspace", async () => {
    const list = vi
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce({
        conversations: [conversationSnapshot("conversation_a", "w1", "2026-08-05T09:00:00.000Z")],
      });
    const api = buildApi({ list });
    const store = new ConversationCatalogStore({ api });
    await store.loadWorkspace("w1");
    expect(store.getSnapshot().phase).toBe("error");
    await store.retry();
    expect(store.getSnapshot().phase).toBe("ready");
    expect(store.getSnapshot().conversations).toHaveLength(1);
  });

  it("createConversation creates with the default agent binding, prepends and activates", async () => {
    const api = buildApi();
    const store = new ConversationCatalogStore({ api });
    await store.loadWorkspace("w1");
    const id = await store.createConversation();
    expect(id).toBe("conversation_created");
    expect(api.conversations.create).toHaveBeenCalledWith({
      agent: DEFAULT_NOVEL_AGENT_BINDING,
    });
    expect(store.getSnapshot().conversations[0].id).toBe("conversation_created");
    expect(store.getSnapshot().activeConversationId).toBe("conversation_created");
  });

  it("selectConversation switches the active conversation", async () => {
    const api = buildApi({
      list: vi.fn(async () => ({
        conversations: [
          conversationSnapshot("conversation_a", "w1", "2026-08-05T08:00:00.000Z"),
          conversationSnapshot("conversation_b", "w1", "2026-08-05T09:00:00.000Z"),
        ],
      })),
    });
    const store = new ConversationCatalogStore({ api });
    await store.loadWorkspace("w1");
    store.selectConversation("conversation_a");
    expect(store.getSnapshot().activeConversationId).toBe("conversation_a");
    store.selectConversation("missing");
    expect(store.getSnapshot().activeConversationId).toBe("conversation_a");
  });

  it("clearWorkspace resets to idle", async () => {
    const api = buildApi();
    const store = new ConversationCatalogStore({ api });
    await store.loadWorkspace("w1");
    store.clearWorkspace();
    expect(store.getSnapshot().phase).toBe("idle");
    expect(store.getSnapshot().workspaceId).toBeUndefined();
  });

  it("serializes concurrent operations", async () => {
    const list = vi.fn(async () => ({ conversations: [] }));
    const api = buildApi({ list });
    const store = new ConversationCatalogStore({ api });
    const order: string[] = [];
    const load = store.loadWorkspace("w1").then(() => order.push("load"));
    const create = store.createConversation().then(() => order.push("create"));
    await Promise.all([load, create]);
    expect(order).toEqual(["load", "create"]);
    expect(list).toHaveBeenCalledTimes(1);
  });
});
