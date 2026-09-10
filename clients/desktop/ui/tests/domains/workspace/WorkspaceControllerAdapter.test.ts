/**
 * WorkspaceControllerAdapter 测试：快照镜像、变化通知、dispose。
 */
import { describe, expect, it } from "vitest";
import { WorkspaceControllerAdapter, type WorkspaceControllerPort } from "../../../src/domains/workspace/store/WorkspaceControllerAdapter.js";
import type { WorkspaceControllerSnapshot } from "../../../src/domains/workspace/controller/WorkspaceController.js";

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

  /** 模拟控制器发布新快照（revision 递增 + 通知订阅者） */
  async publishNext(): Promise<void> {
    this.snapshot = { ...this.snapshot, revision: this.snapshot.revision + 1 };
    for (const listener of [...this.listeners]) listener();
  }
}

function snapshot(overrides: Partial<WorkspaceControllerSnapshot> = {}): WorkspaceControllerSnapshot {
  return {
    revision: 1,
    phase: "ready",
    ...overrides,
  };
}

describe("WorkspaceControllerAdapter", () => {
  it("mirrors the controller snapshot", () => {
    const controller = new FakeController(snapshot({ current: { id: "w1", label: "云端测试书" } }));
    const adapter = new WorkspaceControllerAdapter(controller);
    expect(adapter.getSnapshot().current?.label).toBe("云端测试书");
  });

  it("updates when the controller notifies", async () => {
    const controller = new FakeController(snapshot());
    const adapter = new WorkspaceControllerAdapter(controller);
    await controller.publishNext();
    expect(adapter.getSnapshot().revision).toBe(2);
  });

  it("stops updating after dispose", async () => {
    const controller = new FakeController(snapshot());
    const adapter = new WorkspaceControllerAdapter(controller);
    adapter.dispose();
    await controller.publishNext();
    expect(adapter.getSnapshot().revision).toBe(1);
  });
});
