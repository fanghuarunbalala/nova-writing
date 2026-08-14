/**
 * Conversation 事件火线测试（gui-performance-2 功能点八）：
 * emit 盖 eseq 单调序号 + ZeroMQ 发布器广播（内存 hub 与 PUB 双通道同序）。
 */
import { describe, it, expect } from "vitest";
import { Conversation, type ConversationEventPublisher } from "../Conversation.js";
import type { AgentLoop } from "../../../runtime/loop/AgentLoop.js";
import type { ProjectedEvent } from "../../contract/events/index.js";

function mockLoop(): AgentLoop {
  const listeners = new Set<(e: ProjectedEvent) => void>();
  let seq = 0;
  return {
    run: async () => ({ final: { role: "assistant", content: "ok" }, usage: undefined }),
    followup: (text: string) => {
      const turn = {
        seq: ++seq,
        messages: [{ role: "user", content: text }],
        ts: "t",
        appendRunMessages: () => {},
      };
      for (const l of listeners) {
        l({ type: "run-start", persist: true, seq: turn.seq, runSeq: turn.seq, conversationId: "c1", ts: "t" });
      }
      return turn;
    },
    stop: () => {},
    onOutputEvent: (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  } as unknown as AgentLoop;
}

describe("Conversation 事件火线（eseq 盖章 + PUB 广播）", () => {
  it("emit 盖逐会话单调 eseq，内存订阅者与发布器收到同一事件", async () => {
    const published: Array<{ topic: string; payload: unknown }> = [];
    const publisher: ConversationEventPublisher = {
      publish: (topic, payload) => {
        published.push({ topic, payload });
      },
    };
    const conv = new Conversation({
      conversationId: "c1",
      loop: mockLoop(),
      sampling: { model: "m" },
      eventPublisher: publisher,
    });
    const received: ProjectedEvent[] = [];
    await conv.subscribeEvents((e) => {
      received.push(e);
    });
    await conv.sendUserMessage({ text: "hi" });

    expect(received.length).toBeGreaterThan(0);
    const eseqs = received.map((e) => (e as { eseq?: number }).eseq);
    // 单调递增且从 1 起
    expect(eseqs).toEqual(eseqs.map((_, i) => i + 1));
    // 发布器收到同序事件（topic + 会话归属信封）
    expect(published).toHaveLength(received.length);
    published.forEach((p, i) => {
      expect(p.topic).toBe("conversation.output");
      const envelope = p.payload as { conversationId: string; event: { eseq?: number } };
      expect(envelope.conversationId).toBe("c1");
      expect(envelope.event.eseq).toBe(i + 1);
    });
  });

  it("无发布器时仅内存 hub（publish 零调用），eseq 照常盖章", async () => {
    const conv = new Conversation({
      conversationId: "c1",
      loop: mockLoop(),
      sampling: { model: "m" },
    });
    const received: ProjectedEvent[] = [];
    await conv.subscribeEvents((e) => {
      received.push(e);
    });
    await conv.sendUserMessage({ text: "hi" });
    expect(received.length).toBeGreaterThan(0);
    expect((received[0] as { eseq?: number }).eseq).toBe(1);
  });
});
