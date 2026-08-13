import { describe, it, expect, vi } from "vitest";
import { Conversation } from "../Conversation.js";
import { ConversationManagerServer } from "../ConversationManagerServer.js";
import type { AgentLoop } from "../../../runtime/loop/AgentLoop.js";
import type { OutputEvent } from "../../contract/events/index.js";

function mockLoop(): AgentLoop {
  const listeners = new Set<(e: OutputEvent) => void>();
  const emit = (type: string) => {
    const e = { type, persist: true, seq: 1, turnSeq: 1, conversationId: "c1", ts: "t" } as OutputEvent;
    for (const l of listeners) l(e);
  };
  return {
    run: async () => ({ final: { role: "assistant", content: "ok" }, usage: undefined }),
    followup: () => { emit("turn-start"); },
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

  it("events() 订阅收到事件", async () => {
    const conv = new Conversation({
      conversationId: "c1",
      loop: mockLoop(),
      sampling: { model: "gpt-5" },
    });
    const iter = conv.events()[Symbol.asyncIterator]();
    const msgPromise = conv.sendUserMessage({ text: "hi" });
    const first = await iter.next();
    expect(first.value.type).toBe("turn-start");
    await msgPromise;
  });

  it("sendApprovalRequest 阻塞 + onApprovalRequest 通知 + resolveApproval 回传", async () => {
    const conv = new Conversation({ conversationId: "c1", loop: mockLoop(), sampling: { model: "gpt-5" } });
    const received: string[] = [];
    conv.onApprovalRequest((req) => received.push(req.toolName));
    const pending = conv.sendApprovalRequest({ requestId: "r1", toolName: "Write", args: "{}" });
    // 通知已发出
    expect(received).toEqual(["Write"]);
    // 回传决策
    conv.resolveApproval("r1", { kind: "approve" });
    expect(await pending).toEqual({ kind: "approve" });
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

  it("sendApprovalRequestTo 转发 wait 请求（阻塞到决策）", async () => {
    const conv = new Conversation({ conversationId: "c1", loop: mockLoop(), sampling: { model: "gpt-5" } });
    const server = new ConversationManagerServer({ create: () => conv });
    const ref = await server.createOrResume("c1");
    const pending = server.sendApprovalRequestTo(ref.conversationId, { requestId: "r1", toolName: "Write", args: "{}" });
    // 决策回传（经 resolveApproval）
    conv.resolveApproval("r1", { kind: "reject" });
    expect(await pending).toEqual({ kind: "reject" });
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
