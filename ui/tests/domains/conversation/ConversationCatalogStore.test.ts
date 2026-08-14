/**
 * ConversationCatalogStore 契约测试：load/create/select/clear/retry 与 core API 交互。
 */
import { describe, expect, it, vi } from "vitest";
import type { ConversationSummary, NovelApiClient } from "@novel/core";
import { ConversationCatalogStore } from "../../../src/domains/conversation/store/ConversationCatalogStore.js";

function summary(id: string): ConversationSummary {
  return { conversationId: id, name: id, storeDir: "", status: "active" };
}

function buildApi(overrides: Partial<NovelApiClient["conversations"]> = {}): NovelApiClient {
  return {
    conversations: {
      list: vi.fn(async () => []),
      create: vi.fn(async () => ({ conversationId: "conversation_created", handle: {} })),
      open: vi.fn(),
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

  it("loadWorkspace lists conversations in API order and activates the first", async () => {
    const api = buildApi({
      list: vi.fn(async () => [summary("conversation_new"), summary("conversation_old")]),
    });
    const store = new ConversationCatalogStore({ api });
    await store.loadWorkspace("w1");
    const snapshot = store.getSnapshot();
    expect(api.conversations.list).toHaveBeenCalledWith();
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
      .mockResolvedValueOnce([summary("conversation_a")]);
    const api = buildApi({ list });
    const store = new ConversationCatalogStore({ api });
    await store.loadWorkspace("w1");
    expect(store.getSnapshot().phase).toBe("error");
    await store.retry();
    expect(store.getSnapshot().phase).toBe("ready");
    expect(store.getSnapshot().conversations).toHaveLength(1);
  });

  it("createConversation creates with the novel agent, prepends and activates", async () => {
    const api = buildApi();
    const store = new ConversationCatalogStore({ api });
    await store.loadWorkspace("w1");
    const id = await store.createConversation();
    expect(id).toBe("conversation_created");
    expect(api.conversations.create).toHaveBeenCalledWith("novel");
    expect(store.getSnapshot().conversations[0].id).toBe("conversation_created");
    expect(store.getSnapshot().activeConversationId).toBe("conversation_created");
  });

  it("selectConversation switches the active conversation", async () => {
    const api = buildApi({
      list: vi.fn(async () => [summary("conversation_a"), summary("conversation_b")]),
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
    const list = vi.fn(async () => []);
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
