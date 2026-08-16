import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Conversation } from "../Conversation.js";
import { ConversationManagerServer } from "../ConversationManagerServer.js";
import type { AgentLoop } from "../../../runtime/loop/AgentLoop.js";
import type { RunContext } from "../../../runtime/loop/types.js";
import type { ProjectedEvent } from "../../contract/events/index.js";
import type {
  ConversationJournalService,
  ConversationStateJournalService,
} from "../../contract/journal/index.js";
import type { ConversationHandle } from "../../contract/handle/index.js";
import { ComposeModeService, ComposeModeStateProvider } from "../../compose/index.js";

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
  it("mode.set 记 pending + 发 mode.pending 事件，promotePendingMode 晋升 active（发 mode.changed 由服务承担）", async () => {
    const conv = new Conversation({
      conversationId: "c1",
      loop: mockLoop(),
      sampling: { model: "gpt-5" },
    });
    const events: string[] = [];
    await conv.subscribeEvents((e) => events.push(e.type));
    expect(conv.conversationMode).toBe("review");
    await conv.sendSystemControl({ type: "mode.set", mode: "bypass" });
    // 尚未生效（pending 态）
    expect(conv.conversationMode).toBe("review");
    expect(events).toContain("mode.pending");
    // 每次 provider call 发起时晋升（入口经 beforeProviderCall 注入本方法）
    await conv.promotePendingMode();
    expect(conv.conversationMode).toBe("bypass");
    // 晋升后 pendingMode 清空，重复调用 no-op
    await conv.promotePendingMode();
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
      appendRunMessages: async (seq) => ({ seq, recordedAt: "t" }),
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
    rt.emit({ type: "run-start", seq: 0, persist: true, runSeq: 0, conversationId: "c1", agentId: "Explore:task_1", ts: "t" } as OutputEvent);
    expect(received).toHaveLength(1);
    expect(received[0]?.agentId).toBe("Explore:task_1");
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

  it("sendMessageTo mode.set 经 control 转发（pending 记录），promotePendingMode 后生效", async () => {
    const server = new ConversationManagerServer({
      create: (opts) =>
        new Conversation({ conversationId: opts.conversationId, loop: mockLoop(), sampling: { model: "gpt-5" } }),
    });
    const ref = await server.createOrResume();
    const handle = ref.handle as unknown as {
      conversationMode: string;
      promotePendingMode: () => Promise<void>;
    };
    await server.sendMessageTo(ref.conversationId, { type: "mode.set", mode: "compose" });
    expect(handle.conversationMode).toBe("review");
    await handle.promotePendingMode();
    expect(handle.conversationMode).toBe("compose");
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

  it("根会话 bypass：canonical 写直接批准（入队即决议 + 直推回传，根完全自主）", async () => {
    const conv = new Conversation({ conversationId: "c1", loop: mockLoop(), sampling: { model: "gpt-5" } });
    const server = new ConversationManagerServer({ create: () => conv });
    const ref = await server.createOrResume("c1");
    await conv.sendSystemControl({ type: "mode.set", mode: "bypass" });
    await conv.promotePendingMode();
    const pending = conv.sendApprovalRequest({ requestId: "r1", toolCalls: [{ toolCallId: "t1", toolName: "NovelParagraphWrite", args: "{}" }] });
    await server.submitApprovalRequest(ref.conversationId, { requestId: "r1", toolCalls: [{ toolCallId: "t1", toolName: "NovelParagraphWrite", args: "{}" }] });
    expect(await pending).toEqual({ kind: "approve" });
    // 队列保留记录（重启补完可查）；listApprovals 含已决历史但不出现 pending 条目
    const items = await server.takeDecisions("c1");
    expect(items[0]).toMatchObject({ requestId: "r1", status: "approved" });
    const list = await server.listApprovals();
    expect(list.filter((i) => i.status === "pending")).toHaveLength(0);
  });

  it("根会话 bypass：ExitComposeMode 非 canonical，恒入队 pending（ui 决策）", async () => {
    const conv = new Conversation({ conversationId: "c1", loop: mockLoop(), sampling: { model: "gpt-5" } });
    const server = new ConversationManagerServer({ create: () => conv });
    const ref = await server.createOrResume("c1");
    await conv.sendSystemControl({ type: "mode.set", mode: "bypass" });
    await conv.promotePendingMode();
    await server.submitApprovalRequest(ref.conversationId, { requestId: "r1", toolCalls: [{ toolCallId: "t1", toolName: "ExitComposeMode", args: "{}" }] });
    const list = await server.listApprovals();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ decisioner: "ui", status: "pending", toolCalls: [{ toolName: "ExitComposeMode" }] });
  });

  it("teammate 会话（parentId）→ decisioner=parent 冒泡（不进 ui 队列）", async () => {
    const server = new ConversationManagerServer({
      create: (opts) =>
        new Conversation({ conversationId: opts.conversationId, loop: mockLoop(), sampling: { model: "gpt-5" } }),
    });
    const ref = await server.spawnConversation({ agentType: "novel", parentId: "root-1" });
    await server.submitApprovalRequest(ref.conversationId, { requestId: "r1", toolCalls: [{ toolCallId: "t1", toolName: "CharacterWrite", args: "{}" }] });
    expect(await server.listApprovals()).toHaveLength(0);
    const items = await server.takeDecisions(ref.conversationId);
    expect(items[0]).toMatchObject({ decisioner: "parent", status: "pending" });
  });
});

describe("Conversation + compose 服务集成", () => {
  /** 组装：真实状态机 + 服务（tmpdir designRoot）+ 状态 journal 桩 + hub 事件收集 */
  function makeComposeConv() {
    const dir = mkdtempSync(join(tmpdir(), "novel-conv-compose-"));
    const state = new ComposeModeStateProvider();
    const service = new ComposeModeService({
      composeState: state,
      designRoot: join(dir, "ws", ".novel", "design"),
    });
    const stateJournal = { append: vi.fn(async () => {}) };
    const conv = new Conversation({
      conversationId: "c1",
      loop: mockLoop(),
      sampling: { model: "gpt-5" },
      composeState: state,
      composeService: service,
      stateJournal: stateJournal as never,
    });
    service.setEventSink((e) => conv.emitState(e));
    const hubEvents: OutputEvent[] = [];
    void conv.subscribeEvents((e) => hubEvents.push(e));
    return { dir, state, service, stateJournal, conv, hubEvents };
  }

  /** 进入 compose：mode.set compose → promote（服务 setMode → begin） */
  async function enterCompose(conv: Conversation) {
    await conv.sendSystemControl({ type: "mode.set", mode: "compose" });
    await conv.promotePendingMode();
  }

  it("ExitComposeMode 审批：提交前 submit（pending + compose.submitted 落 state.jsonl），驳回回 designing", async () => {
    const { dir, state, stateJournal, conv, hubEvents } = makeComposeConv();
    await enterCompose(conv);
    expect(state.snapshot("c1").phase).toBe("designing");
    const decision = conv.sendApprovalRequest({ requestId: "r1", toolCalls: [{ toolCallId: "t1", toolName: "ExitComposeMode", args: "{}" }] });
    expect(state.snapshot("c1").phase).toBe("pending");
    expect(hubEvents.some((e) => e.type === "compose.submitted")).toBe(true);
    const appended = stateJournal.append.mock.calls.map((c) => (c[0] as OutputEvent).type);
    expect(appended).toContain("compose.submitted"); // persist 落盘
    // 驳回（附意见）：回 designing + compose.rejected
    conv.resolveApproval("r1", { kind: "edit", text: "节奏太慢" });
    expect(await decision).toEqual({ kind: "edit", text: "节奏太慢" });
    expect(state.snapshot("c1").phase).toBe("designing");
    expect(hubEvents.some((e) => e.type === "compose.rejected")).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("批准决议 → compose.approved 瞬态事件（不落盘）", async () => {
    const { dir, state, stateJournal, conv, hubEvents } = makeComposeConv();
    await enterCompose(conv);
    const decision = conv.sendApprovalRequest({ requestId: "r1", toolCalls: [{ toolCallId: "t1", toolName: "ExitComposeMode", args: "{}" }] });
    conv.resolveApproval("r1", { kind: "approve" });
    expect(await decision).toEqual({ kind: "approve" });
    expect(hubEvents.some((e) => e.type === "compose.approved")).toBe(true);
    const appended = stateJournal.append.mock.calls.map((c) => (c[0] as OutputEvent).type);
    expect(appended).not.toContain("compose.approved"); // 瞬态不落盘
    rmSync(dir, { recursive: true, force: true });
  });

  it("非 ExitComposeMode 审批不驱动 compose 状态", async () => {
    const { dir, state, conv, hubEvents } = makeComposeConv();
    await enterCompose(conv);
    const decision = conv.sendApprovalRequest({ requestId: "r1", toolCalls: [{ toolCallId: "t1", toolName: "CharacterWrite", args: "{}" }] });
    expect(state.snapshot("c1").phase).toBe("designing"); // 不 submit
    conv.resolveApproval("r1", { kind: "reject" });
    expect(await decision).toEqual({ kind: "reject" });
    expect(hubEvents.some((e) => e.type === "compose.submitted")).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("端到端：mode.set compose → begin 建文件 → Exit 审批 approve → exit 归档 + mode.changed(review)", async () => {
    const { dir, state, service, stateJournal, conv, hubEvents } = makeComposeConv();
    await enterCompose(conv);
    const designPath = join(dir, "ws", ".novel", "design", "c1.md");
    expect(existsSync(designPath)).toBe(true);
    // ExitComposeMode 审批：批准决议（gateTool 放行后 handler 调 service.exit 收口）
    const decision = conv.sendApprovalRequest({ requestId: "r1", toolCalls: [{ toolCallId: "t1", toolName: "ExitComposeMode", args: "{}" }] });
    conv.resolveApproval("r1", { kind: "approve" });
    expect(await decision).toEqual({ kind: "approve" });
    await service.exit("c1");
    expect(state.snapshot("c1")).toMatchObject({ mode: "review", active: false, phase: "applied" });
    expect(existsSync(join(dir, "ws", ".novel", "design", "archive", "c1.md"))).toBe(true);
    const appended = stateJournal.append.mock.calls.map((c) => (c[0] as OutputEvent).type);
    expect(appended).toContain("mode.changed"); // persist 落盘（重启 hydrate 依据）
    expect(hubEvents.some((e) => e.type === "compose.applied")).toBe(true);
    rmSync(dir, { recursive: true, force: true });
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
    rt.emit({ type: "tool-call-request", persist: true, seq: 9, toolCallId: "s1", name: "SubTool", args: "{}", conversationId: "c1", agentId: "Explore:task_1", ts: "t" } as OutputEvent);
    rt.emit({ type: "run-end", persist: true, seq: 9, runSeq: 9, conversationId: "c1", agentId: "Explore:task_1", ts: "t" } as OutputEvent);
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

describe("Conversation 稳定性加固", () => {
  /** 桩 compose 服务：setMode 可编程失败（promote 重试语义验证） */
  function stubComposeService(behavior: {
    setMode?: (id: string, target: string) => Promise<void>;
    submit?: () => Promise<void>;
  } = {}) {
    return {
      setMode: behavior.setMode ?? (async () => {}),
      submit: behavior.submit ?? (async () => {}),
      applyPendingModeTarget: async () => {},
      approveOnDecision: async () => {},
      rejectOnDecision: async () => {},
    } as unknown as ComposeModeService;
  }

  it("晋升失败：sendUserMessage 照常入队不丢消息，pendingMode 保留待重试", async () => {
    const calls: string[] = [];
    let fail = true;
    const composeService = stubComposeService({
      setMode: async (_id, target) => {
        calls.push(target);
        if (fail) throw new Error("fs broken");
      },
    });
    const conv = new Conversation({
      conversationId: "c1",
      loop: mockLoop(),
      sampling: { model: "gpt-5" },
      composeService,
    });
    await conv.sendSystemControl({ type: "mode.set", mode: "bypass" });
    // 晋升失败：消息仍入队（拿到回执），mode 目标未丢
    const receipt = await conv.sendUserMessage({ text: "hi" });
    expect(receipt.seq).toBeGreaterThan(0);
    expect(calls).toEqual(["bypass"]);
    // 下一次晋升（beforeProviderCall 注入点）重试成功 → 清 pendingMode
    fail = false;
    await conv.promotePendingMode();
    expect(calls).toEqual(["bypass", "bypass"]);
    await conv.promotePendingMode();
    expect(calls).toHaveLength(2);
  });

  it("无服务回退路径：mode.set 同值晋升也广播 mode.changed（清「待生效」chip）", async () => {
    const conv = new Conversation({
      conversationId: "c1",
      loop: mockLoop(),
      sampling: { model: "gpt-5" },
    });
    const events: string[] = [];
    await conv.subscribeEvents((e) => events.push(e.type));
    await conv.sendSystemControl({ type: "mode.set", mode: "bypass" });
    await conv.promotePendingMode();
    expect(conv.conversationMode).toBe("bypass");
    expect(events).toContain("mode.changed");
    // 同值再设：mode.pending 发出后晋升仍发 mode.changed（chip 不悬挂）
    await conv.sendSystemControl({ type: "mode.set", mode: "bypass" });
    await conv.promotePendingMode();
    expect(events.filter((t) => t === "mode.pending")).toHaveLength(2);
    expect(events.filter((t) => t === "mode.changed")).toHaveLength(2);
  });

  it("hub listener 抛错：不阻断广播与其余订阅者", async () => {
    const conv = new Conversation({
      conversationId: "c1",
      loop: mockLoop(),
      sampling: { model: "gpt-5" },
    });
    const received: string[] = [];
    await conv.subscribeEvents(() => {
      throw new Error("bad subscriber");
    });
    await conv.subscribeEvents((e) => received.push(e.type));
    expect(() =>
      conv.emitState({
        type: "mode.pending",
        persist: false,
        mode: "bypass",
        conversationId: "c1",
        ts: "t",
      }),
    ).not.toThrow();
    expect(received).toContain("mode.pending");
  });

  it("state.jsonl 落盘失败：不抛错、不崩（广播照发）", async () => {
    const conv = new Conversation({
      conversationId: "c1",
      loop: mockLoop(),
      sampling: { model: "gpt-5" },
      stateJournal: {
        append: async () => {
          throw new Error("disk full");
        },
      } as unknown as ConversationStateJournalService,
    });
    const received: string[] = [];
    await conv.subscribeEvents((e) => received.push(e.type));
    await expect(
      conv.emitState({
        type: "mode.changed",
        persist: true,
        mode: "bypass",
        conversationId: "c1",
        ts: "t",
      }),
    ).toBeUndefined();
    expect(received).toContain("mode.changed");
  });

  it("ExitComposeMode submit 抛错：兜底不产生 unhandledRejection，审批照常入队", async () => {
    const conv = new Conversation({
      conversationId: "c1",
      loop: mockLoop(),
      sampling: { model: "gpt-5" },
      composeService: stubComposeService({
        submit: async () => {
          throw new Error("state transition failed");
        },
      }),
      managerWait: { submitApproval: async () => {}, submitAsking: async () => {}, submitExitCompose: async () => {} },
    });
    const pending = conv.sendApprovalRequest({
      requestId: "r1",
      toolCalls: [{ toolCallId: "t1", toolName: "ExitComposeMode", args: "{}" }],
    });
    // 驻留等待由决议解除（不因 submit 失败悬挂/崩溃）
    conv.resolveApproval("r1", { kind: "approve" });
    await expect(pending).resolves.toEqual({ kind: "approve" });
  });
});
