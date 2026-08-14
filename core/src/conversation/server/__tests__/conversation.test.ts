import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Conversation } from "../Conversation.js";
import { ConversationManagerServer } from "../ConversationManagerServer.js";
import type { AgentLoop } from "../../../runtime/loop/AgentLoop.js";
import type { TurnContext } from "../../../runtime/loop/types.js";
import type { OutputEvent } from "../../contract/events/index.js";
import type { ConversationJournalService } from "../../contract/journal/index.js";
import type { ConversationHandle } from "../../contract/handle/index.js";
import { ComposeModeService, ComposeModeStateProvider } from "../../compose/index.js";

function mockLoop(): AgentLoop {
  const listeners = new Set<(e: OutputEvent) => void>();
  const emit = (type: string) => {
    const e = { type, persist: true, seq: 1, turnSeq: 1, conversationId: "c1", ts: "t" } as OutputEvent;
    for (const l of listeners) l(e);
  };
  let seq = 0;
  return {
    run: async () => ({ final: { role: "assistant", content: "ok" }, usage: undefined }),
    followup: (text: string) => {
      const turn: TurnContext = {
        seq: ++seq,
        messages: [{ role: "user", content: text }],
        ts: "t",
        appendTurnMessages: () => {},
      };
      emit("turn-start");
      return turn;
    },
    steer: () => {},
    stop: vi.fn(),
    cancel: vi.fn(),
    onOutputEvent: (l: (e: OutputEvent) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  } as unknown as AgentLoop;
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

  it("subscribeEvents 订阅收到事件", async () => {
    const conv = new Conversation({
      conversationId: "c1",
      loop: mockLoop(),
      sampling: { model: "gpt-5" },
    });
    const received: OutputEvent[] = [];
    await conv.subscribeEvents((e) => received.push(e));
    await conv.sendUserMessage({ text: "hi" });
    expect(received[0]?.type).toBe("turn-start");
  });

  it("有 journal 时输入 rpc 回持久化回执（followup 即时开 turn → appendTurn 同步落盘）", async () => {
    const appended: TurnContext[] = [];
    const journal: ConversationJournalService = {
      open: async () => {},
      lastSeq: 0,
      appendTurn: async (turn) => {
        appended.push(turn);
        return { seq: turn.seq, recordedAt: "t" };
      },
      writeTurns: async () => {},
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
    const submitted: Array<{ id: string; req: { requestId: string; toolName: string } }> = [];
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
    const pending = conv.sendApprovalRequest({ requestId: "r1", toolName: "Write", args: "{}" });
    // 非阻塞提交：立即入 CMS 队列（进程内直连）
    expect(submitted).toHaveLength(1);
    expect(submitted[0]!.id).toBe("c1");
    expect(submitted[0]!.req.toolName).toBe("Write");
    // 决策回传（经 ConversationHandle 契约方法）
    const handle = conv as unknown as ConversationHandle;
    handle.resolveApproval("r1", { kind: "approve" });
    expect(await pending).toEqual({ kind: "approve" });
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
    const decision = await conv.sendApprovalRequest({ requestId: "r1", toolName: "Write", args: "{}" });
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
    const decision = await conv.sendApprovalRequest({ requestId: "r1", toolName: "Write", args: "{}" });
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
    await server.submitApprovalRequest(ref.conversationId, { requestId: "r1", toolName: "CharacterWrite", args: "{}" });
    const list = await server.listApprovals();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ decisioner: "ui", status: "pending", toolName: "CharacterWrite" });
    // 决策：记录 + 直推驻留会话（conversation 的 resolveApproval 解除等待）
    const pending = conv.sendApprovalRequest({ requestId: "r2", toolName: "Write", args: "{}" });
    await server.submitApprovalRequest(ref.conversationId, { requestId: "r2", toolName: "Write", args: "{}" });
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
    const decision = conv.sendApprovalRequest({ requestId: "r1", toolName: "ExitComposeMode", args: "{}" });
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
    const decision = conv.sendApprovalRequest({ requestId: "r1", toolName: "ExitComposeMode", args: "{}" });
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
    const decision = conv.sendApprovalRequest({ requestId: "r1", toolName: "CharacterWrite", args: "{}" });
    expect(state.snapshot("c1").phase).toBe("designing"); // 不 submit
    conv.resolveApproval("r1", { kind: "reject" });
    expect(await decision).toEqual({ kind: "reject" });
    expect(hubEvents.some((e) => e.type === "compose.submitted")).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});
