/**
 * ConversationProjectionBinding 测试：发布节流（32ms 尾沿合并）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationHandle, NovelApiClient, ProjectedEvent } from "@novel/core";
import { ConversationProjectionBinding } from "../../../src/domains/conversation/binding/ConversationProjectionBinding.js";

/** 捕获 subscribeEvents 监听器的假 handle（start 后由测试驱动推送投影事件） */
function fakeHandle(): { handle: ConversationHandle; push: (event: ProjectedEvent) => void } {
  let listener: ((event: ProjectedEvent) => void) | undefined;
  const handle = {
    sendUserMessage: async () => ({ seq: 0, recordedAt: "" }),
    sendSystemControl: async () => ({ seq: 0, recordedAt: "" }),
    resolveApproval: () => {},
    getConversationMode: async () => "review",
    dispose: () => {},
    subscribeEvents: async (l: (event: ProjectedEvent) => void) => {
      listener = l;
    },
  } as unknown as ConversationHandle;
  return {
    handle,
    push: (event) => {
      if (listener === undefined) throw new Error("subscribeEvents 尚未被调用");
      listener(event);
    },
  };
}

/** 最小 NovelApiClient 假体（open 返回给定 handle；projectedHistory 空序列） */
function fakeApi(handle: ConversationHandle): NovelApiClient {
  return {
    conversations: {
      open: async () => handle,
      projectedHistory: async () => [],
    },
  } as unknown as NovelApiClient;
}

/** 一条 text delta 投影事件（loop 层已丢弃 reasoning delta，仅 text 上链） */
function delta(text: string): ProjectedEvent {
  return {
    type: "assistant.delta",
    kind: "text",
    text,
    conversationId: "c1",
    ts: new Date().toISOString(),
  } as ProjectedEvent;
}

describe("ConversationProjectionBinding 发布节流", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("32ms 尾沿窗口内连发投影事件只发布一次", async () => {
    const fake = fakeHandle();
    const binding = new ConversationProjectionBinding({
      api: fakeApi(fake.handle),
      conversationId: "c1",
    });
    let notified = 0;
    binding.subscribe(() => {
      notified += 1;
    });
    await binding.start();
    // 冲刷 start 阶段排程的节流发布（opening/active 状态迁移立即发布，不计入窗口验证）
    vi.advanceTimersByTime(100);
    const baseline = notified;
    expect(baseline).toBeGreaterThan(0);
    // 50–100Hz 场景模拟：窗口内连发 5 条 delta
    for (const ch of ["你", "好", "，", "世", "界"]) {
      fake.push(delta(ch));
    }
    expect(notified).toBe(baseline);
    vi.advanceTimersByTime(31);
    expect(notified).toBe(baseline);
    vi.advanceTimersByTime(1);
    expect(notified).toBe(baseline + 1);
    // 窗口内事件全部并入：发布时读最新投影快照
    const timeline = binding.getSnapshot().projection.timeline;
    expect(timeline[timeline.length - 1]!.text).toBe("你好，世界");
  });

  it("stop 清除待发布的节流定时器", async () => {
    const fake = fakeHandle();
    const binding = new ConversationProjectionBinding({
      api: fakeApi(fake.handle),
      conversationId: "c1",
    });
    let notified = 0;
    binding.subscribe(() => {
      notified += 1;
    });
    await binding.start();
    vi.advanceTimersByTime(100);
    const baseline = notified;
    fake.push(delta("雨"));
    expect(notified).toBe(baseline);
    await binding.stop();
    const afterStop = notified;
    // stopping/stopped 状态迁移立即发布（不等节流窗口）
    expect(afterStop).toBeGreaterThan(baseline);
    vi.advanceTimersByTime(100);
    expect(notified).toBe(afterStop); // 定时器已清除，无尾沿发布
  });
});
