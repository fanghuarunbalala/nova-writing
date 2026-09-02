/**
 * MainViewRouter
 *
 * 主区视图状态机。state ∈ {chat, content, schedule, library}。
 * 维护双栈 history 支持 back/forward。不使用 URL。
 */
import { ExternalStore } from "../state/ExternalStore.js";
import { MainViewHistory } from "./MainViewHistory.js";

export type MainViewState = "chat" | "content" | "schedule" | "library";

export interface MainViewSnapshot {
  readonly state: MainViewState;
  readonly canBack: boolean;
  readonly canForward: boolean;
}

export class MainViewRouter extends ExternalStore<MainViewSnapshot> {
  private readonly history = new MainViewHistory<MainViewState>();

  constructor(initial: MainViewState = "chat") {
    super({ state: initial, canBack: false, canForward: false });
  }

  transition(next: MainViewState): void {
    const current = this.snapshot.state;
    if (next === current) return;
    this.history.push(current);
    this.setSnapshot({
      state: next,
      canBack: this.history.canBack,
      canForward: false,
    });
  }

  back(): void {
    const previous = this.history.back(this.snapshot.state);
    if (previous === undefined) return;
    this.setSnapshot({
      state: previous,
      canBack: this.history.canBack,
      canForward: this.history.canForward,
    });
  }

  forward(): void {
    const next = this.history.forward(this.snapshot.state);
    if (next === undefined) return;
    this.setSnapshot({
      state: next,
      canBack: this.history.canBack,
      canForward: this.history.canForward,
    });
  }
}
