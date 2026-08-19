/**
 * LaunchProgressStore 启动编排状态机测试：
 * - 首开完整流：opening → loading（标题带书名）→ 保底节奏逐步点亮 → 收尾 → boot-in → idle
 * - 真实慢加载：步骤按真实就绪序（前缀约束）点亮，不早于保底节奏
 * - 域 store error 视为 settle（不阻塞进入）
 * - controller 打开失败立即中止回 idle
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LaunchProgressStore,
  type LaunchControllerSource,
  type LaunchDomainStores,
  type LaunchPhaseSource,
} from "../../../src/domains/workspace/launch/LaunchProgressStore.js";

type DomainKey = keyof LaunchDomainStores;
const DOMAIN_KEYS: readonly DomainKey[] = [
  "novelOverview",
  "storyOutlineTree",
  "manuscriptStructure",
  "character",
  "location",
  "conversationCatalog",
];

class FakePhaseStore implements LaunchPhaseSource {
  private snapshot = Object.freeze({ phase: "idle", workspaceId: undefined }) as {
    phase: "idle" | "loading" | "ready" | "error";
    workspaceId: string | undefined;
  };
  private readonly listeners = new Set<() => void>();
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  readonly getSnapshot = () => this.snapshot;
  set(phase: "idle" | "loading" | "ready" | "error", workspaceId: string | undefined): void {
    this.snapshot = Object.freeze({ phase, workspaceId });
    for (const listener of [...this.listeners]) listener();
  }
}

class FakeController implements LaunchControllerSource {
  private snapshot = Object.freeze({
    revision: 0,
    phase: "idle",
    recent: [],
  }) as ReturnType<LaunchControllerSource["getSnapshot"]>;
  private readonly listeners = new Set<() => void>();
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  readonly getSnapshot = () => this.snapshot;
  set(
    update: Partial<{
      phase: "idle" | "loading" | "opening" | "ready" | "closing" | "error" | "selecting";
      current: { id: string; label: string };
    }>,
  ): void {
    this.snapshot = Object.freeze({ ...this.snapshot, revision: this.snapshot.revision + 1, ...update });
    for (const listener of [...this.listeners]) listener();
  }
}

interface Harness {
  readonly controller: FakeController;
  readonly stores: Record<DomainKey, FakePhaseStore>;
  readonly store: LaunchProgressStore;
}

function createHarness(): Harness {
  const controller = new FakeController();
  const stores = Object.fromEntries(DOMAIN_KEYS.map((key) => [key, new FakePhaseStore()])) as Record<
    DomainKey,
    FakePhaseStore
  >;
  const store = new LaunchProgressStore({
    controller,
    domainStores: stores,
    stepIntervalMs: 300,
    settleHoldMs: 550,
    bootInMs: 1000,
  });
  store.attach();
  return { controller, stores, store };
}

/** 全部域 store 置为目标工作区的给定 phase */
function settleAll(harness: Harness, phase: "ready" | "error", workspaceId = "w1"): void {
  for (const key of DOMAIN_KEYS) harness.stores[key].set(phase, workspaceId);
}

function litSteps(harness: Harness): boolean[] {
  return harness.store.getSnapshot().steps.map((step) => step.lit);
}

describe("LaunchProgressStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs full first-open choreography with floor pacing when real load is instant", () => {
    const harness = createHarness();
    harness.controller.set({ phase: "opening" });
    let snap = harness.store.getSnapshot();
    expect(snap.phase).toBe("opening");
    expect(snap.title).toBe("正在打开项目…");
    expect(litSteps(harness)).toEqual([false, false, false, false]);

    // 数据库就绪 → 各域瞬时装完（快于演出节奏）→ 步骤按保底节奏点亮
    harness.controller.set({ phase: "ready", current: { id: "w1", label: "北河旧事" } });
    settleAll(harness, "ready");
    snap = harness.store.getSnapshot();
    expect(snap.phase).toBe("loading");
    expect(snap.title).toBe("正在打开《北河旧事》");

    vi.advanceTimersByTime(300);
    expect(litSteps(harness)).toEqual([true, false, false, false]);
    vi.advanceTimersByTime(300);
    expect(litSteps(harness)).toEqual([true, true, false, false]);
    vi.advanceTimersByTime(600);
    expect(litSteps(harness)).toEqual([true, true, true, true]);
    expect(harness.store.getSnapshot().phase).toBe("loading");

    // 收尾停留 550ms 后进入 boot-in，1000ms 后回 idle
    vi.advanceTimersByTime(549);
    expect(harness.store.getSnapshot().phase).toBe("loading");
    vi.advanceTimersByTime(1);
    expect(harness.store.getSnapshot().phase).toBe("booting");
    vi.advanceTimersByTime(1000);
    expect(harness.store.getSnapshot().phase).toBe("idle");
  });

  it("follows real settle order when load is slow (prefix rule keeps steps ordered)", () => {
    const harness = createHarness();
    harness.controller.set({ phase: "opening" });
    harness.controller.set({ phase: "ready", current: { id: "w1", label: "慢书" } });

    // 会话先就绪也不能点亮第 4 步（前缀「载入大纲树」未 settle）
    harness.stores.conversationCatalog.set("ready", "w1");
    vi.advanceTimersByTime(2000);
    expect(litSteps(harness)).toEqual([false, false, false, false]);

    // 大纲组在 2s 就绪（保底阈值已过）→ 全部步骤依次瞬间点亮
    harness.stores.novelOverview.set("ready", "w1");
    harness.stores.storyOutlineTree.set("ready", "w1");
    harness.stores.manuscriptStructure.set("ready", "w1");
    harness.stores.character.set("ready", "w1");
    harness.stores.location.set("ready", "w1");
    expect(litSteps(harness)).toEqual([true, true, true, true]);
    expect(harness.store.getSnapshot().phase).toBe("loading");

    // 收尾停留从全亮时刻起算
    vi.advanceTimersByTime(550);
    expect(harness.store.getSnapshot().phase).toBe("booting");
  });

  it("treats domain store error as settled (does not block entry)", () => {
    const harness = createHarness();
    harness.controller.set({ phase: "opening" });
    harness.controller.set({ phase: "ready", current: { id: "w1", label: "带伤的书" } });
    settleAll(harness, "error");
    vi.advanceTimersByTime(1200);
    expect(litSteps(harness)).toEqual([true, true, true, true]);
    vi.advanceTimersByTime(550);
    expect(harness.store.getSnapshot().phase).toBe("booting");
  });

  it("aborts to idle immediately when controller open fails", () => {
    const harness = createHarness();
    harness.controller.set({ phase: "opening" });
    harness.controller.set({ phase: "ready", current: { id: "w1", label: "书" } });
    settleAll(harness, "ready");
    vi.advanceTimersByTime(600);
    expect(harness.store.getSnapshot().phase).toBe("loading");

    harness.controller.set({ phase: "error" });
    expect(harness.store.getSnapshot().phase).toBe("idle");
    // 中止后不再推进
    vi.advanceTimersByTime(5000);
    expect(harness.store.getSnapshot().phase).toBe("idle");
  });

  it("increments launchId across launches (in-app switch replays boot-in)", () => {
    const harness = createHarness();
    const firstId = harness.store.getSnapshot().launchId;
    harness.controller.set({ phase: "opening" });
    harness.controller.set({ phase: "ready", current: { id: "w1", label: "一" } });
    settleAll(harness, "ready");
    vi.advanceTimersByTime(1750);
    expect(harness.store.getSnapshot().phase).toBe("booting");
    vi.advanceTimersByTime(1000);
    expect(harness.store.getSnapshot().phase).toBe("idle");

    // 关闭回欢迎页后再开另一本（切到新 id，域 store 重新装载）
    harness.controller.set({ phase: "closing" });
    harness.controller.set({ phase: "idle", current: undefined });
    harness.controller.set({ phase: "opening" });
    expect(harness.store.getSnapshot().launchId).toBe(firstId + 2);
    expect(harness.store.getSnapshot().phase).toBe("opening");
    harness.controller.set({ phase: "ready", current: { id: "w2", label: "二" } });
    // 旧工作区的 ready 快照不算 settle（workspaceId 不匹配）
    vi.advanceTimersByTime(1500);
    expect(litSteps(harness)).toEqual([false, false, false, false]);
    settleAll(harness, "ready", "w2");
    expect(litSteps(harness)).toEqual([true, true, true, true]);
    vi.advanceTimersByTime(550);
    expect(harness.store.getSnapshot().phase).toBe("booting");
  });
});
