/**
 * MainViewHistory
 *
 * 双栈浏览历史（back/forward），与 URL 无关。由 MainViewRouter 持有，
 * 泛型 S 限定为视图状态类型。
 */
export class MainViewHistory<S> {
  private backStack: S[] = [];
  private forwardStack: S[] = [];

  get canBack(): boolean {
    return this.backStack.length > 0;
  }

  get canForward(): boolean {
    return this.forwardStack.length > 0;
  }

  /** 记录一次新导航：当前状态入 back 栈，forward 栈清空。 */
  push(current: S): void {
    this.backStack.push(current);
    this.forwardStack = [];
  }

  /** 后退：返回上一个状态；无历史时返回 undefined。 */
  back(current: S): S | undefined {
    const previous = this.backStack.pop();
    if (previous === undefined) return undefined;
    this.forwardStack.push(current);
    return previous;
  }

  /** 前进：返回下一个状态；无 forward 历史时返回 undefined。 */
  forward(current: S): S | undefined {
    const next = this.forwardStack.pop();
    if (next === undefined) return undefined;
    this.backStack.push(current);
    return next;
  }

  clear(): void {
    this.backStack = [];
    this.forwardStack = [];
  }
}
