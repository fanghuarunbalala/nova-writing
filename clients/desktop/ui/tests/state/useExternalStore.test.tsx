/**
 * useExternalStore hook 测试：快照读取与变更重渲染。
 */
import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { ExternalStore } from "../../src/shared/state/ExternalStore.js";
import { useExternalStore } from "../../src/shared/state/useExternalStore.js";

class CounterStore extends ExternalStore<{ readonly value: number }> {
  constructor() {
    super({ value: 0 });
  }

  setValue(value: number): void {
    this.setSnapshot({ value });
  }
}

function CounterProbe({ store }: { readonly store: CounterStore }) {
  const snapshot = useExternalStore(store);
  return <output>{snapshot.value}</output>;
}

describe("useExternalStore", () => {
  it("renders the current snapshot and re-renders on change", () => {
    const store = new CounterStore();
    render(<CounterProbe store={store} />);
    expect(screen.getByRole("status")).toHaveTextContent("0");
    act(() => store.setValue(5));
    expect(screen.getByRole("status")).toHaveTextContent("5");
  });
});
