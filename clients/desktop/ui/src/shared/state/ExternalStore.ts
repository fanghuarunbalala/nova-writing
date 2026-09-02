/**
 * ExternalStore
 *
 * 所有域 store 的抽象基类。约定：
 * - subscribe / getSnapshot 必须是箭头函数属性，保证 useSyncExternalStore 引用稳定
 * - 所有快照必须 immutable；通过 setSnapshot 自动深度 freeze
 */
import { ImmutableSnapshot } from "./ImmutableSnapshot.js";

export abstract class ExternalStore<S> {
  protected snapshot: S;
  private readonly listeners = new Set<() => void>();

  protected constructor(initial: S) {
    this.snapshot = ImmutableSnapshot.freeze(initial);
  }

  /** 订阅快照变化；返回取消订阅函数。 */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** 获取当前快照（immutable）。 */
  readonly getSnapshot = (): S => this.snapshot;

  /**
   * 替换快照并通知所有订阅者。
   * 若 next 与当前快照 Object.is 相等则跳过。自动深度 freeze。
   */
  protected setSnapshot(next: S): void {
    if (Object.is(next, this.snapshot)) return;
    this.snapshot = ImmutableSnapshot.freeze(next);
    this.notify();
  }

  /** 仅触发通知（用于快照内部 mutable 引用未变但内容已改的场景；不推荐常用）。 */
  protected notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
