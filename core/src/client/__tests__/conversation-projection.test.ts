/**
 * ConversationProjection（客户端投影）单测：
 * - subagent 隔离：盖章（agentId ≠ main）事件不进主流时间线
 * - 工具行分组：无正文间隔的连续工具行并入同段（demo .toolGroup 单盒多行），
 *   正文出现才开新段
 */
import { describe, expect, it, vi } from "vitest";
import { ConversationProjection } from "../ConversationProjection.js";
import type { ConversationHandle } from "../../conversation/contract/handle/index.js";
import type { ProjectedEvent } from "../../conversation/contract/events/index.js";

/** 捕获 subscribeEvents 监听器的假 handle（start 后由测试驱动推送投影事件） */
function fakeHandle(): { handle: ConversationHandle; push: (event: ProjectedEvent) => void } {
  let listener: ((event: ProjectedEvent) => void) | undefined;
  const handle = {
    sendUserMessage: async () => ({ seq: 0, recordedAt: "" }),
    sendUserCommand: async () => ({ seq: 0, recordedAt: "" }),
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

const base = { conversationId: "c1" } as const;

function delta(text: string, agentId?: string): ProjectedEvent {
  return {
    type: "assistant.delta",
    kind: "text",
    text,
    ...base,
    ts: new Date().toISOString(),
    ...(agentId !== undefined ? { agentId } : {}),
  } as ProjectedEvent;
}
function userMessage(text: string, agentId?: string): ProjectedEvent {
  return {
    type: "user.message",
    persist: true,
    seq: 1,
    text,
    ...base,
    ts: new Date().toISOString(),
    ...(agentId !== undefined ? { agentId } : {}),
  } as ProjectedEvent;
}
function toolStarted(id: string): ProjectedEvent {
  return {
    type: "tool-recorded.started",
    seq: 10,
    toolCallId: id,
    name: "read_file",
    ...base,
    ts: new Date().toISOString(),
  } as unknown as ProjectedEvent;
}
function toolRecorded(id: string): ProjectedEvent {
  return {
    type: "tool-recorded.recorded",
    seq: 11,
    toolCallId: id,
    name: "read_file",
    outcome: "ok",
    durationMs: 5,
    ...base,
    ts: new Date().toISOString(),
  } as unknown as ProjectedEvent;
}
function assistantMessage(text: string): ProjectedEvent {
  return {
    type: "assistant.message",
    persist: true,
    seq: 12,
    text,
    ...base,
    ts: new Date().toISOString(),
  } as unknown as ProjectedEvent;
}
function runEnd(): ProjectedEvent {
  return {
    type: "run-end",
    persist: true,
    seq: 13,
    runSeq: 1,
    ...base,
    ts: new Date().toISOString(),
  } as unknown as ProjectedEvent;
}

describe("ConversationProjection subagent 隔离（agentId 过滤）", () => {
  it("盖章（非 main）事件不进时间线；未盖章与 main 正常进入", async () => {
    const fake = fakeHandle();
    const proj = new ConversationProjection(fake.handle, "c1");
    await proj.start();

    fake.push(delta("主流程"));
    fake.push(delta("子任务输出", "Explore:task_1"));
    fake.push(userMessage("子任务 prompt", "Explore:task_1"));
    fake.push(delta("继续", "main"));

    const timeline = proj.getSnapshot().timeline;
    const assistantTexts = timeline
      .filter((i) => i.kind === "assistant")
      .map((i) => i.text)
      .join("");
    expect(assistantTexts).toBe("主流程继续");
    // subagent 的 user.message 不产生时间线项
    expect(timeline.filter((i) => i.kind === "user")).toHaveLength(0);
  });
});

describe("ConversationProjection 工具行并组（无正文间隔并入同段）", () => {
  it("连续工具行（中间无正文）并入同段单组；尾文本续句并入该段", async () => {
    const fake = fakeHandle();
    const proj = new ConversationProjection(fake.handle, "c1");
    await proj.start();

    fake.push(delta("先查"));
    fake.push(toolStarted("t1"));
    fake.push(toolRecorded("t1"));
    fake.push(toolStarted("t2"));
    fake.push(toolRecorded("t2"));
    fake.push(delta("完成"));

    const item = proj.getSnapshot().timeline.at(-1)!;
    const segments = item.segments!;
    // 段结构：[先查完成 + t1、t2]（无正文间隔的连续调用同组；"完成"无句读结尾 → 续句并入）
    expect(segments).toHaveLength(1);
    expect(segments[0]!.text).toBe("先查完成");
    expect(segments[0]!.tools.map((t) => t.traceId)).toEqual(["t1", "t2"]);
    expect(item.text).toBe("先查完成");
  });
});

describe("ConversationProjection 续句合并（审批暂停后正文不在句中断裂）", () => {
  it("半句被审批打断（无句读结尾）→ 新请求文本并入上一段，单段连续", async () => {
    const fake = fakeHandle();
    const proj = new ConversationProjection(fake.handle, "c1");
    await proj.start();

    fake.push(delta("我先读"));
    fake.push(toolStarted("t1"));
    fake.push(toolRecorded("t1"));
    fake.push(delta("角色档案"));
    fake.push(delta("如下"));

    const item = proj.getSnapshot().timeline.at(-1)!;
    const segments = item.segments!;
    expect(segments).toHaveLength(1);
    expect(segments[0]!.text).toBe("我先读角色档案如下");
    expect(item.text).toBe("我先读角色档案如下");
  });

  it("句读收尾（。结尾）→ 新请求文本开新段，段间分隔", async () => {
    const fake = fakeHandle();
    const proj = new ConversationProjection(fake.handle, "c1");
    await proj.start();

    fake.push(delta("我先看看现有档案。"));
    fake.push(toolStarted("t1"));
    fake.push(toolRecorded("t1"));
    fake.push(delta("现在开始写入"));
    fake.push({
      type: "assistant.message",
      persist: true,
      seq: 12,
      ...base,
      ts: new Date().toISOString(),
    } as unknown as ProjectedEvent);

    const item = proj.getSnapshot().timeline.at(-1)!;
    const segments = item.segments!;
    expect(segments).toHaveLength(2);
    expect(segments[0]!.text).toBe("我先看看现有档案。");
    expect(segments[1]!.text).toBe("现在开始写入");
  });

  it("句读收尾后的续流多 delta 不在首块边界拆段（断字换行回归）", async () => {
    const fake = fakeHandle();
    const proj = new ConversationProjection(fake.handle, "c1");
    await proj.start();

    // 审批/工具段收口 + 上一段以句号结尾（不接受续句合并）
    fake.push(delta("这一大纲编辑需要审核，应该会弹出审批面板。"));
    fake.push(toolStarted("t1"));
    fake.push(toolRecorded("t1"));
    // 续流正文按多条 delta 到达（流式分块边界可在词中间）
    fake.push(delta("已触发审批流程"));
    fake.push(delta("并生效"));
    fake.push(delta("：第一个场景状态由 ready 改为 outlined。"));
    fake.push({
      type: "run-end",
      persist: true,
      seq: 1,
      runSeq: 1,
      ...base,
      ts: new Date().toISOString(),
    } as unknown as ProjectedEvent);

    const item = proj.getSnapshot().timeline.at(-1)!;
    const segments = item.segments!;
    // 续流正文是完整一句：不得被首条 delta（「已触发审批流程」）提前封段
    expect(segments).toHaveLength(2);
    expect(segments[0]!.text).toBe("这一大纲编辑需要审核，应该会弹出审批面板。");
    expect(segments[1]!.text).toBe("已触发审批流程并生效：第一个场景状态由 ready 改为 outlined。");
    expect(item.text).toBe(
      "这一大纲编辑需要审核，应该会弹出审批面板。已触发审批流程并生效：第一个场景状态由 ready 改为 outlined。",
    );
  });

  it("句读收尾后的正文开新段（此前连续工具已并组）", async () => {
    const fake = fakeHandle();
    const proj = new ConversationProjection(fake.handle, "c1");
    await proj.start();

    fake.push(delta("第一句。"));
    fake.push(toolStarted("t1"));
    fake.push(toolRecorded("t1"));
    fake.push(toolStarted("t2"));
    fake.push(toolRecorded("t2"));
    fake.push(delta("继续"));
    fake.push({
      type: "run-end",
      persist: true,
      seq: 1,
      runSeq: 1,
      ...base,
      ts: new Date().toISOString(),
    } as unknown as ProjectedEvent);

    const item = proj.getSnapshot().timeline.at(-1)!;
    const segments = item.segments!;
    expect(segments).toHaveLength(2);
    expect(segments[0]!.text).toBe("第一句。");
    expect(segments[0]!.tools.map((t) => t.traceId)).toEqual(["t1", "t2"]);
    expect(segments[1]!.text).toBe("继续");
    expect(segments[1]!.tools).toHaveLength(0);
    expect(item.text).toBe("第一句。继续");
  });

  it("续句合并后再次出现工具行 → 并入同组；其后文本无句读结尾续句并入", async () => {
    const fake = fakeHandle();
    const proj = new ConversationProjection(fake.handle, "c1");
    await proj.start();

    fake.push(delta("我先读"));
    fake.push(toolStarted("t1"));
    fake.push(toolRecorded("t1"));
    fake.push(delta("到了"));
    fake.push(toolStarted("t2"));
    fake.push(toolRecorded("t2"));
    fake.push(delta("接着写"));

    const item = proj.getSnapshot().timeline.at(-1)!;
    const segments = item.segments!;
    expect(segments).toHaveLength(1);
    expect(segments[0]!.text).toBe("我先读到了接着写");
    expect(segments[0]!.tools.map((t) => t.traceId)).toEqual(["t1", "t2"]);
    expect(item.text).toBe("我先读到了接着写");
  });
});

describe("ConversationProjection 轮文本与收口（demo 交错形态）", () => {
  it("重放多轮（journal 按轮落盘 assistant.message）：单条消息，正文与工具组按出现顺序交错", async () => {
    const fake = fakeHandle();
    const proj = new ConversationProjection(fake.handle, "c1");
    await proj.start();

    fake.push(userMessage("测试"));
    fake.push(assistantMessage("我先看一下。"));
    fake.push(toolStarted("t1"));
    fake.push(toolRecorded("t1"));
    fake.push(assistantMessage("写入。"));
    fake.push(toolStarted("t2"));
    fake.push(toolRecorded("t2"));
    fake.push(assistantMessage("完成。"));
    fake.push(runEnd());

    const timeline = proj.getSnapshot().timeline;
    // 一个 run 收口为单条 assistant 消息（不按轮拆多条）
    expect(timeline.filter((i) => i.kind === "assistant")).toHaveLength(1);
    const item = timeline.at(-1)!;
    const segments = item.segments!;
    // 交错形态：[先看一下 + t1] [写入 + t2] [完成]
    expect(segments.map((s) => s.text)).toEqual(["我先看一下。", "写入。", "完成。"]);
    expect(segments[0]!.tools.map((t) => t.traceId)).toEqual(["t1"]);
    expect(segments[1]!.tools.map((t) => t.traceId)).toEqual(["t2"]);
    expect(item.text).toBe("我先看一下。写入。完成。");
    expect(item.streaming).toBe(false);
  });

  it("live 收尾 assistant.message 与已流式文本幂等去重（不重复、不覆盖丢前轮）", async () => {
    const fake = fakeHandle();
    const proj = new ConversationProjection(fake.handle, "c1");
    await proj.start();

    fake.push(delta("先看。"));
    fake.push(toolStarted("t1"));
    fake.push(toolRecorded("t1"));
    fake.push(delta("结论。"));
    // 流式期间：未封缓冲以尾段并入快照（段文本拼接恒等于全文，交错形态稳定）
    let item = proj.getSnapshot().timeline.at(-1)!;
    expect(item.segments!.at(-1)!.text).toBe("结论。");
    expect(item.segments!.at(-1)!.tools).toHaveLength(0);
    expect(item.text).toBe("先看。结论。");

    // 收尾只带最后一轮文本：已流式 → 去重跳过（不覆盖丢前轮、不重复追加）
    fake.push(assistantMessage("结论。"));
    fake.push(runEnd());

    item = proj.getSnapshot().timeline.at(-1)!;
    expect(item.text).toBe("先看。结论。");
    expect(item.segments!.map((s) => s.text)).toEqual(["先看。", "结论。"]);
    expect(item.streaming).toBe(false);
  });
});

describe("ConversationProjection delta 置脏与合并发布（gui-performance-2 功能点三）", () => {
  it("窗口内 N 条 delta → 监听器至多 1 次通知（32ms 尾沿合并）", async () => {
    vi.useFakeTimers();
    try {
      const fake = fakeHandle();
      const proj = new ConversationProjection(fake.handle, "c1");
      await proj.start();
      let notifications = 0;
      proj.subscribe(() => {
        notifications += 1;
      });
      const baseline = notifications;

      fake.push(delta("a"));
      fake.push(delta("b"));
      fake.push(delta("c"));
      fake.push(delta("d"));
      // 窗口内：delta 不触发发布（置脏 + 排程）
      expect(notifications).toBe(baseline);

      await vi.advanceTimersByTimeAsync(32);
      expect(notifications).toBe(baseline + 1);
      const snapshot = proj.getSnapshot();
      expect(snapshot.timeline.at(-1)).toMatchObject({ text: "abcd", streaming: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("getSnapshot 惰性冲刷：窗口未到期直接读取也能看到最新 delta 文本", async () => {
    const fake = fakeHandle();
    const proj = new ConversationProjection(fake.handle, "c1");
    await proj.start();
    fake.push(delta("写到"));
    fake.push(delta("一半"));
    // 未 advance 定时器：读取方仍能看到合并后的脏文本
    const snapshot = proj.getSnapshot();
    expect(snapshot.timeline.at(-1)).toMatchObject({ text: "写到一半", streaming: true });
    expect(snapshot.liveState).toBe("generating");
  });

  it("非 delta 事件立即发布且先冲刷脏文本（保序）", async () => {
    const fake = fakeHandle();
    const proj = new ConversationProjection(fake.handle, "c1");
    await proj.start();
    let notifications = 0;
    proj.subscribe(() => {
      notifications += 1;
    });
    const baseline = notifications;

    fake.push(delta("先想"));
    fake.push(toolStarted("t1")); // 非 delta → 立即 publish（冲刷脏文本先行）
    expect(notifications).toBe(baseline + 1);
    const item = proj.getSnapshot().timeline.at(-1)!;
    expect(item.text).toBe("先想");
    expect(item.segments!.at(-1)!.tools.map((t) => t.traceId)).toEqual(["t1"]);
  });

  it("run-end 收口：脏文本经立即发布路径进入最终快照", async () => {
    const fake = fakeHandle();
    const proj = new ConversationProjection(fake.handle, "c1");
    await proj.start();
    fake.push(delta("最终"));
    fake.push({
      type: "run-end",
      persist: true,
      seq: 1,
      runSeq: 1,
      ...base,
      ts: new Date().toISOString(),
    } as unknown as ProjectedEvent);
    const snapshot = proj.getSnapshot();
    expect(snapshot.timeline.at(-1)).toMatchObject({ text: "最终", streaming: false });
    expect(snapshot.liveState).toBeUndefined();
  });
});

describe("ConversationProjection 平台事件源与 eseq 断档（gui-performance-2 功能点八）", () => {
  /** kkrpc subscribeEvents 抛错（断言平台源路径完全旁路）+ 可推送的平台源 */
  function platformSourceHarness(): {
    handle: ConversationHandle;
    source: { subscribe: (id: string, l: (e: ProjectedEvent) => void) => () => void };
    push: (event: ProjectedEvent) => void;
    unsubscribed: boolean;
  } {
    const handle = {
      sendUserMessage: async () => ({ seq: 0, recordedAt: "" }),
      sendSystemControl: async () => ({ seq: 0, recordedAt: "" }),
      resolveApproval: () => {},
      getConversationMode: async () => "review",
      dispose: () => {},
      subscribeEvents: async () => {
        throw new Error("kkrpc subscribeEvents 不应被调用（平台源已注入）");
      },
    } as unknown as ConversationHandle;
    let listener: ((e: ProjectedEvent) => void) | undefined;
    const harness = {
      handle,
      source: {
        subscribe: (_id: string, l: (e: ProjectedEvent) => void) => {
          listener = l;
          return () => {
            unsubscribedFlag = true;
            listener = undefined;
          };
        },
      },
      push: (event: ProjectedEvent) => {
        if (listener === undefined) throw new Error("平台源尚未订阅");
        listener(event);
      },
      unsubscribed: false,
    };
    let unsubscribedFlag = false;
    Object.defineProperty(harness, "unsubscribed", { get: () => unsubscribedFlag });
    return harness;
  }

  it("平台事件源路径：事件经 source 交付（kkrpc subscribeEvents 旁路），stop 拆除订阅", async () => {
    const harness = platformSourceHarness();
    const proj = new ConversationProjection(harness.handle, "c1", async () => [], harness.source);
    await proj.start();
    harness.push(userMessage("hi"));
    harness.push(delta("流式"));
    const snapshot = proj.getSnapshot();
    expect(snapshot.timeline.map((i) => i.kind)).toEqual(["user", "assistant"]);
    expect(snapshot.timeline.at(-1)).toMatchObject({ text: "流式" });
    await proj.stop();
    expect(harness.unsubscribed).toBe(true);
  });

  it("eseq 断档 → 触发 history 补拉（ZMQ 丢包自愈）；连续断档不叠加补拉", async () => {
    const harness = platformSourceHarness();
    let historyCalls = 0;
    const history = async (): Promise<ProjectedEvent[]> => {
      historyCalls += 1;
      return [];
    };
    const proj = new ConversationProjection(harness.handle, "c1", history, harness.source);
    await proj.start();
    expect(historyCalls).toBe(1); // 初始重放
    harness.push({ ...userMessage("hi"), eseq: 1 });
    harness.push({ ...delta("a"), eseq: 2 });
    // 断档：跳过 eseq 3、4
    harness.push({ ...delta("c"), eseq: 5 });
    await new Promise((resolve) => setTimeout(resolve, 0)); // 等 catch-up 微任务
    expect(historyCalls).toBe(2);
    // 后续连续事件（无新断档）不再补拉
    harness.push({ ...delta("d"), eseq: 6 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(historyCalls).toBe(2);
  });

  it("重放事件无 eseq（journal 域）不建立基线：首个实时事件不误报断档", async () => {
    const harness = platformSourceHarness();
    const history = async (): Promise<ProjectedEvent[]> => [
      userMessage("历史消息") as ProjectedEvent,
    ];
    const proj = new ConversationProjection(harness.handle, "c1", history, harness.source);
    await proj.start();
    // 首个实时事件 eseq=100（重放不建立基线）→ 不触发补拉
    harness.push({ ...delta("live"), eseq: 100 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const snapshot = proj.getSnapshot();
    expect(snapshot.timeline.at(-1)).toMatchObject({ text: "live" });
  });
});
