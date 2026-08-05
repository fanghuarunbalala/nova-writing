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
    expect(draft.mode).toBe("chat");
    expect(draft.references).toHaveLength(0);
  });

  it("setText updates text and keeps other fields", () => {
    const store = new ComposerDraftStore();
    store.setText("c1", "你好");
    const draft = store.getDraft("c1");
    expect(draft.text).toBe("你好");
    expect(draft.mode).toBe("chat");
  });

  it("setMode switches the composer mode", () => {
    const store = new ComposerDraftStore();
    store.setMode("c1", "rewrite");
    expect(store.getDraft("c1").mode).toBe("rewrite");
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
});
