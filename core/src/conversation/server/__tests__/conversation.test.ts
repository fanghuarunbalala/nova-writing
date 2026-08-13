import { describe, it, expect, vi } from "vitest";
import { Conversation } from "../Conversation.js";
import { ConversationManagerServer } from "../ConversationManagerServer.js";
import type { AgentLoop } from "../../../runtime/loop/AgentLoop.js";
import type { OutputEvent } from "../../contract/events/index.js";

function mockLoop(onEvent?: (e: OutputEvent) => void): AgentLoop {
  return {
    run: async (_input, _runConfig, cb) => {
      cb?.({ type: "turn-start", persist: true, seq: 1, turnSeq: 1, conversationId: "c1", ts: "t" });
      onEvent?.({ type: "turn-start", persist: true, seq: 1, turnSeq: 1, conversationId: "c1", ts: "t" });
      return { final: { role: "assistant", content: "ok" }, usage: undefined };
    },
    cancel: vi.fn(),
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
});
