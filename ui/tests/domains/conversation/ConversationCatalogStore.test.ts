/**
 * ConversationCatalogStore 契约测试（现行 API）：
 * load/create/select/clear/retry 与 core API 交互 + 标题（summary.name / 自动格式）+
 * renameConversation / applyDerivedTitle。
 */
import { describe, expect, it, vi } from "vitest";
import type { NovelApiClient } from "@novel/core";
import { ConversationCatalogStore } from "../../../src/domains/conversation/store/ConversationCatalogStore.js";

/** ConversationSummary 夹具 */
function summary(id: string, name = id) {
  return { conversationId: id, name, storeDir: "", status: "active" as const };
}

function buildApi(overrides: Partial<NovelApiClient["conversations"]> = {}): NovelApiClient {
  return {
    conversations: {
      list: vi.fn(async () => []),
      create: vi.fn(async () => ({ conversationId: "conversation_created", handle: {} })),
      open: vi.fn(),
      delete: vi.fn(async () => undefined),
      rename: vi.fn(async () => true),
      history: vi.fn(async () => []),
      getMode: vi.fn(async () => "review"),
      ...overrides,
    },
  } as unknown as NovelApiClient;
}

describe("ConversationCatalogStore", () => {
  it("starts idle with no workspace", () => {
    const store = new ConversationCatalogStore({ api: buildApi() });
    expect(store.getSnapshot().phase).toBe("idle");
    expect(store.getSnapshot().conversations).toHaveLength(0);
  });

  it("loadWorkspace lists summaries: 显式名展示、未命名回退自动格式、首条选中", async () => {
    const api = buildApi({
      list: vi.fn(async () => [
        summary("conv_000001", "雨景改稿"),
        summary("conv_000002"),
      ]),
    });
    const store = new ConversationCatalogStore({ api });
    await store.loadWorkspace("w1");
    const snapshot = store.getSnapshot();
    expect(snapshot.phase).toBe("ready");
    expect(snapshot.workspaceId).toBe("w1");
    expect(snapshot.conversations.map((item) => item.title)).toEqual([
      "雨景改稿",
      "对话 000002",
    ]);
    expect(snapshot.activeConversationId).toBe("conv_000001");
    expect(snapshot.conversations[0]!.agentLabel).toBe("Novel Agent");
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
      .mockResolvedValueOnce([summary("conv_000001")]);
    const api = buildApi({ list });
    const store = new ConversationCatalogStore({ api });
    await store.loadWorkspace("w1");
    expect(store.getSnapshot().phase).toBe("error");
    await store.retry();
    expect(store.getSnapshot().phase).toBe("ready");
    expect(store.getSnapshot().conversations).toHaveLength(1);
  });

  it("createConversation prepends with auto title and activates", async () => {
    const api = buildApi();
    const store = new ConversationCatalogStore({ api });
    await store.loadWorkspace("w1");
    const id = await store.createConversation();
    expect(id).toBe("conversation_created");
    expect(api.conversations.create).toHaveBeenCalledWith("novel");
    expect(store.getSnapshot().conversations[0]!.title).toBe("对话 reated");
    expect(store.getSnapshot().activeConversationId).toBe("conversation_created");
  });

  it("selectConversation switches the active conversation", async () => {
    const api = buildApi({
      list: vi.fn(async () => [summary("conv_000001"), summary("conv_000002")]),
    });
    const store = new ConversationCatalogStore({ api });
    await store.loadWorkspace("w1");
    store.selectConversation("conv_000002");
    expect(store.getSnapshot().activeConversationId).toBe("conv_000002");
    store.selectConversation("missing");
    expect(store.getSnapshot().activeConversationId).toBe("conv_000002");
  });

  it("clearWorkspace resets to idle", async () => {
    const store = new ConversationCatalogStore({ api: buildApi() });
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

  it("renameConversation 经 api 持久化并本地 patch 标题；空名/未命中失败", async () => {
    const rename = vi.fn(async () => true);
    const api = buildApi({ list: vi.fn(async () => [summary("conv_000001")]), rename });
    const store = new ConversationCatalogStore({ api });
    await store.loadWorkspace("w1");

    await store.renameConversation("conv_000001", "  雨夜对话  ");
    expect(rename).toHaveBeenCalledWith("conv_000001", "雨夜对话");
    expect(store.getSnapshot().conversations[0]!.title).toBe("雨夜对话");

    await expect(store.renameConversation("conv_000001", "   ")).rejects.toThrow();
    const miss = buildApi({ list: vi.fn(async () => [summary("conv_000001")]), rename: vi.fn(async () => false) });
    const missStore = new ConversationCatalogStore({ api: miss });
    await missStore.loadWorkspace("w1");
    await expect(missStore.renameConversation("conv_000001", "名字")).rejects.toThrow();
  });

  it("applyDerivedTitle 只在自动标题上生效（显式改名不覆盖），超 30 字截断", async () => {
    const api = buildApi({ list: vi.fn(async () => [summary("conv_000001")]) });
    const store = new ConversationCatalogStore({ api });
    await store.loadWorkspace("w1");

    store.applyDerivedTitle("conv_000001", "把雨景改成夜景，顺便加点风");
    expect(store.getSnapshot().conversations[0]!.title).toBe("把雨景改成夜景，顺便加点风");

    const long = "一".repeat(42);
    store.applyDerivedTitle("conv_000001", long);
    expect(store.getSnapshot().conversations[0]!.title).toBe("把雨景改成夜景，顺便加点风"); // 已非自动标题 → 不覆盖

    await store.renameConversation("conv_000001", "显式名");
    store.applyDerivedTitle("conv_000001", "后来发的消息");
    expect(store.getSnapshot().conversations[0]!.title).toBe("显式名");

    store.clearWorkspace();
    const api2 = buildApi({ list: vi.fn(async () => [summary("conv_000002")]) });
    const store2 = new ConversationCatalogStore({ api: api2 });
    await store2.loadWorkspace("w1");
    store2.applyDerivedTitle("conv_000002", long);
    expect(store2.getSnapshot().conversations[0]!.title).toBe(`${long.slice(0, 30)}…`);
  });
});
