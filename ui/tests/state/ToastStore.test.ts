/**
 * ToastStore 单元测试：push/dismiss/顺序/快照不可变。
 */
import { describe, expect, it } from "vitest";
import { ToastStore } from "../../src/shared/state/ToastStore.js";

describe("ToastStore", () => {
  it("push appends a toast with id and createdAt", () => {
    const store = new ToastStore();
    const id = store.push({ kind: "info", text: "hello" });
    const snapshot = store.getSnapshot();
    expect(snapshot.toasts).toHaveLength(1);
    expect(snapshot.toasts[0].id).toBe(id);
    expect(snapshot.toasts[0].kind).toBe("info");
    expect(snapshot.toasts[0].text).toBe("hello");
    expect(typeof snapshot.toasts[0].createdAt).toBe("number");
    expect(Object.isFrozen(snapshot.toasts)).toBe(true);
  });

  it("preserves insertion order", () => {
    const store = new ToastStore();
    store.push({ kind: "info", text: "a" });
    store.push({ kind: "danger", text: "b" });
    expect(store.getSnapshot().toasts.map((t) => t.text)).toEqual(["a", "b"]);
  });

  it("dismiss removes only the matching toast", () => {
    const store = new ToastStore();
    const a = store.push({ kind: "info", text: "a" });
    const b = store.push({ kind: "warn", text: "b" });
    store.dismiss(a);
    expect(store.getSnapshot().toasts.map((t) => t.text)).toEqual(["b"]);
    store.dismiss(b);
    expect(store.getSnapshot().toasts).toHaveLength(0);
  });

  it("dismiss of an unknown id is a no-op", () => {
    const store = new ToastStore();
    store.push({ kind: "info", text: "a" });
    store.dismiss("missing");
    expect(store.getSnapshot().toasts).toHaveLength(1);
  });
});
