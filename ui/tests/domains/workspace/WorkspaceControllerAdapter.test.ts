/**
 * WorkspaceControllerAdapter 测试：快照镜像、变化通知、dispose。
 */
import { describe, expect, it } from "vitest";
import { WorkspaceControllerAdapter, type WorkspaceControllerPort } from "../../../src/domains/workspace/store/WorkspaceControllerAdapter.js";
import type { WorkspaceControllerSnapshot } from "../../../src/workspace/WorkspaceController.js";

class FakeController implements WorkspaceControllerPort {
  snapshot: WorkspaceControllerSnapshot;
  private readonly listeners = new Set<() => void>();

  constructor(snapshot: WorkspaceControllerSnapshot) {
    this.snapshot = snapshot;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): WorkspaceControllerSnapshot => this.snapshot;

  async refresh(): Promise<void> {
    this.snapshot = { ...this.snapshot, revision: this.snapshot.revision + 1 };
    for (const listener of [...this.listeners]) listener();
  }
}

function snapshot(overrides: Partial<WorkspaceControllerSnapshot> = {}): WorkspaceControllerSnapshot {
  return {
    revision: 1,
    phase: "ready",
    recent: [],
    ...overrides,
  };
}

describe("WorkspaceControllerAdapter", () => {
  it("mirrors the controller snapshot", () => {
    const controller = new FakeController(snapshot({ current: { id: "w1", label: "白昼计划" } }));
    const adapter = new WorkspaceControllerAdapter(controller);
    expect(adapter.getSnapshot().current?.label).toBe("白昼计划");
  });

  it("updates when the controller notifies", async () => {
    const controller = new FakeController(snapshot());
    const adapter = new WorkspaceControllerAdapter(controller);
    await adapter.refresh();
    expect(adapter.getSnapshot().revision).toBe(2);
  });

  it("stops updating after dispose", async () => {
    const controller = new FakeController(snapshot());
    const adapter = new WorkspaceControllerAdapter(controller);
    adapter.dispose();
    await adapter.refresh();
    expect(adapter.getSnapshot().revision).toBe(1);
  });
});
