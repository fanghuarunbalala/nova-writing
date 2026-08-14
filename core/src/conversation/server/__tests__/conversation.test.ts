import { describe, it, expect, vi } from "vitest";
import { Conversation } from "../Conversation.js";
import { ConversationManagerServer } from "../ConversationManagerServer.js";
import type { AgentLoop } from "../../../runtime/loop/AgentLoop.js";
import type { RunContext } from "../../../runtime/loop/types.js";
import type { ProjectedEvent } from "../../contract/events/index.js";
import type { ConversationJournalService } from "../../contract/journal/index.js";
import type { ConversationHandle } from "../../contract/handle/index.js";

function mockLoop(extraEmit?: (emit: (type: string, extra?: Record<string, unknown>) => void) => void): AgentLoop {
  const listeners = new Set<(e: ProjectedEvent) => void>();
  const emit = (type: string, extra?: Record<string, unknown>) => {
    const e = { type, persist: true, seq: 1, runSeq: 1, conversationId: "c1", ts: "t", ...extra } as ProjectedEvent;
    for (const l of listeners) l(e);
  };
  let seq = 0;
  return {
    run: async () => ({ final: { role: "assistant", content: "ok" }, usage: undefined }),
    followup: (text: string) => {
      const turn: RunContext = {
        seq: ++seq,
        messages: [{ role: "user", content: text }],
        ts: "t",
        appendRunMessages: () => {},
      };
      emit("run-start");
      extraEmit?.(emit);
      return turn;
    },
    steer: () => {},
    stop: vi.fn(),
    cancel: vi.fn(),
    onOutputEvent: (l: (e: ProjectedEvent) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    toolDispatcher: { resolve: () => undefined },
  } as unknown as AgentLoop;
}

/** fake subagentRuntime：可手动 emit 事件、断言 stopAll */
function mockRuntime() {
  const listeners = new Set<(e: OutputEvent) => void>();
  return {
    onEvent: (l: (e: OutputEvent) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    stopAll: vi.fn(),
    emit: (e: OutputEvent) => {
      for (const l of listeners) l(e);
    },
  };
}

describe("Conversation", () => {
  it("mode.set 不立即生效，下次 sendUserMessage 才生效（pendingMode → activeMode）", async () => {
    const conv = new Conversation({
      conversationId: "c1",
      loop: mockLoop(),
      sampling: { model: "gpt-5" },
    });
    expect(conv.conversationMode).toBe("review");
    await conv.sendSystemControl({ type: "mode.set", mode: "bypass" });
    // 尚未生效
    expect(conv.conversationMode).toBe("review");
    await conv.sendUserMessage({ text: "hi" });
    // 下次 turn 生效
    expect(conv.conversationMode).toBe("bypass");
  });

  it("bypass 模式下 sendApprovalRequest 直接放行（不提交队列、不驻留等待）", async () => {
    const submitted: unknown[] = [];
    const conv = new Conversation({
      conversationId: "c1",
      loop: mockLoop(),
      sampling: { model: "gpt-5" },
      managerWait: {
        submitApproval: async (_id, _req) => {
          submitted.push(1);
        },
        submitAsking: async () => {},
        submitExitCompose: async () => {},
      },
    });
    await conv.sendSystemControl({ type: "mode.set", mode: "bypass" });
    await conv.sendUserMessage({ text: "hi" });
    const decision = await conv.sendApprovalRequest({ requestId: "r1", toolCalls: [{ toolCallId: "t1", toolName: "Write", args: "{}" }] });
    expect(decision).toEqual({ kind: "approve" });
    expect(submitted).toHaveLength(0);
  });

  it("initialMode 恢复 + 模式生效时回调 onModeChanged（同值不重复回调）", async () => {
    const persisted: string[] = [];
    const conv = new Conversation({
      conversationId: "c1",
      loop: mockLoop(),
      sampling: { model: "gpt-5" },
      initialMode: "bypass",
      onModeChanged: (mode) => persisted.push(mode),
    });
    expect(conv.conversationMode).toBe("bypass");
    // 初始值不重复持久化
    await conv.sendUserMessage({ text: "hi" });
    expect(persisted).toHaveLength(0);
    await conv.sendSystemControl({ type: "mode.set", mode: "review" });
    await conv.sendUserMessage({ text: "again" });
    expect(persisted).toEqual(["review"]);
  });

  it("subscribeEvents 订阅收到事件", async () => {
    const conv = new Conversation({
      conversationId: "c1",
      loop: mockLoop(),
      sampling: { model: "gpt-5" },
    });
    const received: ProjectedEvent[] = [];
    await conv.subscribeEvents((e) => received.push(e));
    await conv.sendUserMessage({ text: "hi" });
    expect(received[0]?.type).toBe("run-start");
  });

  it("hub 只广播投影事件：tool-call 以 tool-recorded 成对出现，无完整 request/response", async () => {
    const conv = new Conversation({
      conversationId: "c1",
      loop: mockLoop((emit) => {
        emit("tool-call-request", { toolCallId: "t1", name: "CharacterWrite", args: '{"values":[]}' });
        emit("tool-call-response", { toolCallId: "t1", result: "ok" });
      }),
      sampling: { model: "gpt-5" },
    });
    const received: ProjectedEvent[] = [];
    await conv.subscribeEvents((e) => received.push(e));
    await conv.sendUserMessage({ text: "hi" });
    const types = received.map((e) => e.type);
    expect(types).toContain("tool-recorded.started");
    expect(types).toContain("tool-recorded.recorded");
    expect(types).not.toContain("tool-call-request");
    expect(types).not.toContain("tool-call-response");
    expect(types).not.toContain("approval.request");
    expect(types).not.toContain("approval.resolved");
  });

  it("有 journal 时输入 rpc 回持久化回执（followup 即时开 turn → appendRun 同步落盘）", async () => {
    const appended: RunContext[] = [];
    const journal: ConversationJournalService = {
      open: async () => {},
      lastSeq: 0,
      appendRun: async (turn) => {
        appended.push(turn);
        return { seq: turn.seq, recordedAt: "t" };
      },
      writeRuns: async () => {},
      flush: async () => {},
      close: async () => {},
      reconcile: async () => {},
    };
    const conv = new Conversation({
      conversationId: "c1",
      loop: mockLoop(),
      sampling: { model: "gpt-5" },
      journal,
    });
    const receipt = await conv.sendUserMessage({ text: "hi" });
    expect(receipt.seq).toBe(1);
    expect(appended).toHaveLength(1);
    expect(appended[0]!.messages[0]).toMatchObject({ role: "user", content: "hi" });
    // 控制类回执：用 journal.lastSeq
    const control = await conv.sendSystemControl({ type: "stop" });
    expect(control.seq).toBe(0);
  });

  it("无 journal 时输入 rpc 回 turn seq（内存回退）", async () => {
    const conv = new Conversation({ conversationId: "c1", loop: mockLoop(), sampling: { model: "gpt-5" } });
    const receipt = await conv.sendUserMessage({ text: "hi" });
    expect(receipt.seq).toBe(1);
  });

  it("sendApprovalRequest 无阻塞驻留 + 经 managerWait 提交 + resolveApproval 回传解除", async () => {
    const submitted: Array<{ id: string; req: { requestId: string; toolCalls: readonly { toolName: string }[] } }> = [];
    const conv = new Conversation({
      conversationId: "c1",
      loop: mockLoop(),
      sampling: { model: "gpt-5" },
      managerWait: {
        submitApproval: async (id, req) => {
          submitted.push({ id, req });
        },
        submitAsking: async () => {},
        submitExitCompose: async () => {},
      },
    });
    const pending = conv.sendApprovalRequest({ requestId: "r1", toolCalls: [{ toolCallId: "t1", toolName: "Write", args: "{}" }] });
    // 非阻塞提交：立即入 CMS 队列（进程内直连）
    expect(submitted).toHaveLength(1);
    expect(submitted[0]!.id).toBe("c1");
    expect(submitted[0]!.req.toolCalls[0]!.toolName).toBe("Write");
    // 决策回传（经 ConversationHandle 契约方法）
    const handle = conv as unknown as ConversationHandle;
    handle.resolveApproval("r1", { kind: "approve" });
    expect(await pending).toEqual({ kind: "approve" });
  });

  it("subagentRuntime 事件转发进 hub（live-only）", async () => {
    const rt = mockRuntime();
    const conv = new Conversation({
      conversationId: "c1",
      loop: mockLoop(),
      sampling: { model: "gpt-5" },
      subagentRuntime: rt as never,
    });
    const received: OutputEvent[] = [];
    await conv.subscribeEvents((e) => received.push(e));
    rt.emit({ type: "run-start", seq: 0, persist: true, runSeq: 0, conversationId: "c1", agentId: "novel_explorer:task_1", ts: "t" } as OutputEvent);
    expect(received).toHaveLength(1);
    expect(received[0]?.agentId).toBe("novel_explorer:task_1");
  });

  it("sendSystemControl stop 级联 stopAll", async () => {
    const rt = mockRuntime();
    const loop = mockLoop();
    const conv = new Conversation({
      conversationId: "c1",
      loop,
      sampling: { model: "gpt-5" },
      subagentRuntime: rt as never,
    });
    await conv.sendSystemControl({ type: "stop" });
    expect(loop.stop).toHaveBeenCalled();
    expect(rt.stopAll).toHaveBeenCalled();
  });

  it("dispose 级联 stopAll", () => {
    const rt = mockRuntime();
    const conv = new Conversation({
      conversationId: "c1",
      loop: mockLoop(),
      sampling: { model: "gpt-5" },
      subagentRuntime: rt as never,
    });
    conv.dispose();
    expect(rt.stopAll).toHaveBeenCalled();
  });

  it("wait 超时按拒绝解除（waitTimeoutMs 可缩短测试）", async () => {
    const conv = new Conversation({
      conversationId: "c1",
      loop: mockLoop(),
      sampling: { model: "gpt-5" },
      waitTimeoutMs: 30,
      managerWait: {
        submitApproval: async () => {},
        submitAsking: async () => {},
        submitExitCompose: async () => {},
      },
    });
    const decision = await conv.sendApprovalRequest({ requestId: "r1", toolCalls: [{ toolCallId: "t1", toolName: "Write", args: "{}" }] });
    expect(decision).toEqual({ kind: "reject" });
  });

  it("managerWait 提交失败立即按拒绝解除", async () => {
    const conv = new Conversation({
      conversationId: "c1",
      loop: mockLoop(),
      sampling: { model: "gpt-5" },
      managerWait: {
        submitApproval: async () => {
          throw new Error("cms down");
        },
        submitAsking: async () => {},
        submitExitCompose: async () => {},
      },
    });
    const decision = await conv.sendApprovalRequest({ requestId: "r1", toolCalls: [{ toolCallId: "t1", toolName: "Write", args: "{}" }] });
    expect(decision).toEqual({ kind: "reject" });
  });

  it("sendAskingQuestionRequest 阻塞 + resolveQuestion 回传", async () => {
    const conv = new Conversation({ conversationId: "c1", loop: mockLoop(), sampling: { model: "gpt-5" } });
    const pending = conv.sendAskingQuestionRequest({ requestId: "q1", questions: ["怎么写？"] });
    conv.resolveQuestion("q1", "就这样写");
    expect(await pending).toBe("就这样写");
  });
});

describe("ConversationManagerServer", () => {
  it("spawnConversation + list + sendMessageTo", async () => {
    const created: Conversation[] = [];
    const server = new ConversationManagerServer({
      create: (opts) => {
        const conv = new Conversation({
          conversationId: opts.conversationId,
          loop: mockLoop(),
          sampling: { model: "gpt-5" },
        });
        created.push(conv);
        return conv;
      },
    });
    const ref = await server.spawnConversation({ agentType: "novel" });
    expect(ref.conversationId).toBeTruthy();
    const list = await server.list();
    expect(list).toHaveLength(1);
    await server.sendMessageTo(ref.conversationId, { text: "hi" });
  });

  it("sendMessageTo mode.set 经 control 转发，下次生效", async () => {
    const server = new ConversationManagerServer({
      create: (opts) =>
        new Conversation({ conversationId: opts.conversationId, loop: mockLoop(), sampling: { model: "gpt-5" } }),
    });
    const ref = await server.createOrResume();
    await server.sendMessageTo(ref.conversationId, { type: "mode.set", mode: "compose" });
    expect((ref.handle as unknown as { conversationMode: string }).conversationMode).toBe("review");
    await server.sendMessageTo(ref.conversationId, { text: "hi" });
    expect((ref.handle as unknown as { conversationMode: string }).conversationMode).toBe("compose");
  });

  it("submitApprovalRequest 入队 + listApprovals 可见 + resolveApproval 直推驻留会话", async () => {
    const conv = new Conversation({ conversationId: "c1", loop: mockLoop(), sampling: { model: "gpt-5" } });
    const server = new ConversationManagerServer({ create: () => conv });
    const ref = await server.createOrResume("c1");
    await server.submitApprovalRequest(ref.conversationId, {
      requestId: "r1",
      toolCalls: [{ toolCallId: "t1", toolName: "CharacterWrite", args: "{}" }],
    });
    const list = await server.listApprovals();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      decisioner: "ui",
      status: "pending",
      toolCalls: [{ toolCallId: "t1", toolName: "CharacterWrite", args: "{}" }],
    });
    // 决策：记录 + 直推驻留会话（conversation 的 resolveApproval 解除等待）
    const pending = conv.sendApprovalRequest({
      requestId: "r2",
      toolCalls: [{ toolCallId: "t2", toolName: "Write", args: "{}" }],
    });
    await server.submitApprovalRequest(ref.conversationId, {
      requestId: "r2",
      toolCalls: [{ toolCallId: "t2", toolName: "Write", args: "{}" }],
    });
    expect(await server.resolveApproval("r2", { kind: "reject" })).toBe(true);
    expect(await pending).toEqual({ kind: "reject" });
    expect(await server.takeDecisions("c1")).toHaveLength(2);
  });

  it("terminate 清理会话", async () => {
    const server = new ConversationManagerServer({
      create: (opts) =>
        new Conversation({ conversationId: opts.conversationId, loop: mockLoop(), sampling: { model: "gpt-5" } }),
    });
    const ref = await server.createOrResume();
    await server.terminate(ref.conversationId);
    expect((await server.list())[0].status).toBe("stopped");
  });
});

describe("Conversation subagent 投影层隔离", () => {
  it("subagent run-end 只清自己的 pending：main 未配对 tool-call 不退化为 unknown", async () => {
    // main 脚本：run1 发出 m1 request（不配对）；run2（subagent 结束后）补 m1 response
    const script: Array<(emit: (type: string, extra?: Record<string, unknown>) => void) => void> = [
      (emit) => emit("tool-call-request", { toolCallId: "m1", name: "MainTool", args: "{}" }),
    ];
    const rt = mockRuntime();
    const conv = new Conversation({
      conversationId: "c1",
      loop: mockLoop((emit) => script.shift()?.(emit)),
      sampling: { model: "gpt-5" },
      subagentRuntime: rt as never,
    });
    const received: ProjectedEvent[] = [];
    await conv.subscribeEvents((e) => received.push(e));

    // run1：main 发出 m1 request（pending 挂起）
    await conv.sendUserMessage({ text: "a" });
    // subagent 任务事件插入（含未配对 s1 + run-end；旧实现会顺带清掉 main 的 m1）
    rt.emit({ type: "tool-call-request", persist: true, seq: 9, toolCallId: "s1", name: "SubTool", args: "{}", conversationId: "c1", agentId: "novel_explorer:task_1", ts: "t" } as OutputEvent);
    rt.emit({ type: "run-end", persist: true, seq: 9, runSeq: 9, conversationId: "c1", agentId: "novel_explorer:task_1", ts: "t" } as OutputEvent);
    // run2：main 配对 m1 —— pending 未被 subagent 清掉则 name 正确（否则 unknown）
    script.push((emit) => emit("tool-call-response", { toolCallId: "m1", result: "ok" }));
    await conv.sendUserMessage({ text: "b" });

    const mainRecorded = received.find(
      (e): e is Extract<ProjectedEvent, { type: "tool-recorded.recorded" }> =>
        e.type === "tool-recorded.recorded" && e.toolCallId === "m1",
    );
    expect(mainRecorded).toBeDefined();
    expect(mainRecorded?.name).toBe("MainTool");
  });
});
