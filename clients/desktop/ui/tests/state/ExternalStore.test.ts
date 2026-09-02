/**
 * ExternalStore 单元测试：订阅通知、快照不可变性、引用稳定跳过。
 */
import { describe, expect, it, vi } from "vitest";
import { ExternalStore } from "../../src/shared/state/ExternalStore.js";

interface CountSnapshot {
  readonly count: number;
}

class CounterStore extends ExternalStore<CountSnapshot> {
  constructor() {
    super({ count: 0 });
  }

  increment(): void {
    this.setSnapshot({ count: this.snapshot.count + 1 });
  }

  setSameSnapshot(): void {
    this.setSnapshot(this.snapshot);
  }
}

describe("ExternalStore", () => {
  it("notifies subscribers on snapshot change and supports unsubscribe", () => {
    const store = new CounterStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.increment();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().count).toBe(1);
    unsubscribe();
    store.increment();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("returns an immutable snapshot", () => {
    const store = new CounterStore();
    store.increment();
    const snapshot = store.getSnapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(() => {
      (snapshot as { count: number }).count = 99;
    }).toThrow();
  });

  it("skips notify when the next snapshot is the same reference", () => {
    const store = new CounterStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.setSameSnapshot();
    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps subscribe/getSnapshot references stable", () => {
    const store = new CounterStore();
    const { subscribe: s1, getSnapshot: g1 } = store;
    store.increment();
    expect(store.subscribe).toBe(s1);
    expect(store.getSnapshot).toBe(g1);
  });
});
