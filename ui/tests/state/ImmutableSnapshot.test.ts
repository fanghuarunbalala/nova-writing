/**
 * ImmutableSnapshot 单元测试：深度冻结与深比较。
 */
import { describe, expect, it } from "vitest";
import { ImmutableSnapshot } from "../../src/shared/state/ImmutableSnapshot.js";

describe("ImmutableSnapshot.freeze", () => {
  it("deep-freezes nested objects and arrays", () => {
    const value = ImmutableSnapshot.freeze({
      list: [{ id: "a" }, { id: "b" }],
      meta: { tags: ["x"] },
    });
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.list)).toBe(true);
    expect(Object.isFrozen(value.list[0])).toBe(true);
    expect(Object.isFrozen(value.meta.tags)).toBe(true);
  });

  it("returns primitives untouched", () => {
    expect(ImmutableSnapshot.freeze(1)).toBe(1);
    expect(ImmutableSnapshot.freeze("a")).toBe("a");
    expect(ImmutableSnapshot.freeze(null)).toBeNull();
  });

  it("is idempotent on already-frozen values", () => {
    const obj = Object.freeze({ a: 1 });
    expect(ImmutableSnapshot.freeze(obj)).toBe(obj);
  });
});

describe("ImmutableSnapshot.deepEqual", () => {
  it("returns true for equal nested values and false otherwise", () => {
    expect(ImmutableSnapshot.deepEqual({ a: [1, 2] }, { a: [1, 2] })).toBe(true);
    expect(ImmutableSnapshot.deepEqual({ a: [1, 2] }, { a: [1, 3] })).toBe(false);
    expect(ImmutableSnapshot.deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it("handles primitives and null", () => {
    expect(ImmutableSnapshot.deepEqual(1, 1)).toBe(true);
    expect(ImmutableSnapshot.deepEqual(null, null)).toBe(true);
    expect(ImmutableSnapshot.deepEqual({ a: null }, { a: 1 })).toBe(false);
  });

  it("compares arrays by length and order", () => {
    expect(ImmutableSnapshot.deepEqual([1, 2], [1, 2])).toBe(true);
    expect(ImmutableSnapshot.deepEqual([1, 2], [2, 1])).toBe(false);
    expect(ImmutableSnapshot.deepEqual([1, 2], [1])).toBe(false);
  });
});
