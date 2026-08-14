/**
 * ConversationProjection（客户端投影）单测：
 * - subagent 隔离：盖章（agentId ≠ main）事件不进主流时间线
 * - 连续工具批次：两次请求的工具行分段（每请求一段）
 */
import { describe, expect, it } from "vitest";
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

describe("ConversationProjection subagent 隔离（agentId 过滤）", () => {
  it("盖章（非 main）事件不进时间线；未盖章与 main 正常进入", async () => {
    const fake = fakeHandle();
    const proj = new ConversationProjection(fake.handle, "c1");
    await proj.start();

    fake.push(delta("主流程"));
    fake.push(delta("子任务输出", "novel_explorer:task_1"));
    fake.push(userMessage("子任务 prompt", "novel_explorer:task_1"));
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

describe("ConversationProjection 连续工具批次分段（每请求一段）", () => {
  it("两次连续工具请求（中间无正文）渲染为两段工具行，不并段", async () => {
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
    // 段结构：[先查 + t1] [空文本 + t2] [完成]（最后段缓冲收口前在 text 字段）
    expect(segments).toHaveLength(2);
    expect(segments[0]!.text).toBe("先查");
    expect(segments[0]!.tools.map((t) => t.traceId)).toEqual(["t1"]);
    expect(segments[1]!.tools.map((t) => t.traceId)).toEqual(["t2"]);
  });
});
