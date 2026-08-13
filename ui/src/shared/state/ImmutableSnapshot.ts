/**
 * ImmutableSnapshot
 *
 * 深度冻结工具 + 深比较工具。保证快照不可变，防止外部误改导致 React 缓存失效；
 * deepEqual 供派生 store 复用引用、避免无谓 notify。
 */
export const ImmutableSnapshot = {
  freeze<T>(value: T): T {
    if (value === null || typeof value !== "object") return value;
    if (Object.isFrozen(value)) return value;
    if (Array.isArray(value)) {
      Object.freeze(value);
      for (const item of value) {
        this.freeze(item);
      }
      return value;
    }
    Object.freeze(value);
    const keys = Object.keys(value as Record<string, unknown>);
    for (const key of keys) {
      this.freeze((value as Record<string, unknown>)[key]);
    }
    return value;
  },

  deepEqual<T>(a: T, b: T): boolean {
    if (Object.is(a, b)) return true;
    if (a === null || b === null) return false;
    if (typeof a !== "object" || typeof b !== "object") return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      if (a.length !== (b as unknown[]).length) return false;
      for (let i = 0; i < a.length; i++) {
        if (!this.deepEqual(a[i], (b as unknown[])[i])) return false;
      }
      return true;
    }
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b as object);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!this.deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
        return false;
      }
    }
    return true;
  },
};
