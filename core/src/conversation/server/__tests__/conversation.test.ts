import { describe, it, expect, vi } from "vitest";
import { Conversation } from "../Conversation.js";
import { ConversationManagerServer } from "../ConversationManagerServer.js";
import type { AgentLoop } from "../../../runtime/loop/AgentLoop.js";
import type { TurnContext } from "../../../runtime/loop/types.js";
import type { ProjectedEvent } from "../../contract/events/index.js";
import type { ConversationJournalService } from "../../contract/journal/index.js";
import type { ConversationHandle } from "../../contract/handle/index.js";

function mockLoop(): AgentLoop {
  const listeners = new Set<(e: ProjectedEvent) => void>();
  const emit = (type: string) => {
    const e = { type, persist: true, seq: 1, turnSeq: 1, conversationId: "c1", ts: "t" } as ProjectedEvent;
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
    onOutputEvent: (l: (e: ProjectedEvent) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  } as unknown as AgentLoop;
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

  it("subscribeEvents 订阅收到事件", async () => {
    const conv = new Conversation({
      conversationId: "c1",
      loop: mockLoop(),
      sampling: { model: "gpt-5" },
    });
    const received: ProjectedEvent[] = [];
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
