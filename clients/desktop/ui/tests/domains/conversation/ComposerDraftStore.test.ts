/**
 * ComposerDraftStore 单元测试：默认草稿、文本/模式/引用变更、clear、不可变性。
 */
import { describe, expect, it } from "vitest";
import { ComposerDraftStore, type ComposerReference } from "../../../src/domains/conversation/store/ComposerDraftStore.js";

const characterRef: ComposerReference = Object.freeze({
  kind: "character",
  id: "char-linxia",
  label: "林夏",
});

describe("ComposerDraftStore", () => {
  it("returns a default draft for an unknown conversation", () => {
    const store = new ComposerDraftStore();
    const draft = store.getDraft("c1");
    expect(draft.conversationId).toBe("c1");
    expect(draft.text).toBe("");
    expect(draft.mode).toBe("review");
    expect(draft.references).toHaveLength(0);
  });

  it("setText updates text and keeps other fields", () => {
    const store = new ComposerDraftStore();
    store.setText("c1", "你好");
    const draft = store.getDraft("c1");
    expect(draft.text).toBe("你好");
    expect(draft.mode).toBe("review");
  });

  it("setMode switches the composer mode", () => {
    const store = new ComposerDraftStore();
    store.setMode("c1", "bypass");
    expect(store.getDraft("c1").mode).toBe("bypass");
  });

  it("addReference appends and dedupes by kind+id", () => {
    const store = new ComposerDraftStore();
    store.addReference("c1", characterRef);
    store.addReference("c1", characterRef);
    expect(store.getDraft("c1").references).toHaveLength(1);
    store.addReference("c1", { kind: "location", id: "loc-dock7", label: "船坞" });
    expect(store.getDraft("c1").references).toHaveLength(2);
  });

  it("removeReference removes by reference id", () => {
    const store = new ComposerDraftStore();
    store.addReference("c1", characterRef);
    store.removeReference("c1", "char-linxia");
    expect(store.getDraft("c1").references).toHaveLength(0);
  });

  it("clear removes the draft entry", () => {
    const store = new ComposerDraftStore();
    store.setText("c1", "草稿");
    store.clear("c1");
    expect(store.getDraft("c1").text).toBe("");
    expect(store.getSnapshot()).toHaveLength(0);
  });

  it("clearAll empties every draft (workspace switch)", () => {
    const store = new ComposerDraftStore();
    store.setText("conv_1", "A 项目草稿");
    store.setText("conv_2", "另一会话草稿");
    store.clearAll();
    expect(store.getSnapshot()).toHaveLength(0);
    // 空态再调用为 no-op（快照引用不变）
    const snapshot = store.getSnapshot();
    store.clearAll();
    expect(store.getSnapshot()).toBe(snapshot);
  });

  it("keeps snapshots immutable", () => {
    const store = new ComposerDraftStore();
    store.setText("c1", "草稿");
    const snapshot = store.getSnapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot[0])).toBe(true);
    expect(() => {
      (snapshot[0] as { text: string }).text = "改写";
    }).toThrow();
  });

  it("rejects invalid text and references", () => {
    const store = new ComposerDraftStore();
    expect(() => store.setText("c1", "a\u0000b")).toThrow();
    expect(() => store.addReference("c1", { kind: "character", id: "", label: "" })).toThrow();
  });

  it("accepts all five reference kinds (人物/地点/大纲/章/段落)", () => {
    const store = new ComposerDraftStore();
    store.addReference("c1", { kind: "character", id: "ch-1", label: "林夏" });
    store.addReference("c1", { kind: "location", id: "l-1", label: "旧船坞" });
    store.addReference("c1", { kind: "outline", id: "u1", label: "第一章 · 雾起" });
    store.addReference("c1", { kind: "chapter", id: "chap-1", label: "雾起" });
    store.addReference("c1", { kind: "paragraph", id: "p-1", label: "段 1 · 雾起" });
    expect(store.getDraft("c1").references).toHaveLength(5);
    // kind 越界仍拒绝
    expect(() =>
      store.addReference("c1", { kind: "volume", id: "v-1", label: "第一卷" } as unknown as ComposerReference),
    ).toThrow();
  });

  it("clearReferences empties references but keeps text and mode", () => {
    const store = new ComposerDraftStore();
    store.setText("c1", "帮我收紧这段");
    store.setMode("c1", "compose");
    store.addReference("c1", characterRef);
    store.addReference("c1", { kind: "paragraph", id: "p-1", label: "段 1" });
    store.clearReferences("c1");
    const draft = store.getDraft("c1");
    expect(draft.references).toHaveLength(0);
    expect(draft.text).toBe("帮我收紧这段");
    expect(draft.mode).toBe("compose");
    // 空引用再清为 no-op（草稿引用不变）
    const before = store.getDraft("c1");
    store.clearReferences("c1");
    expect(store.getDraft("c1")).toBe(before);
  });
});
