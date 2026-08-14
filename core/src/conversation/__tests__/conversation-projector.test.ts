import { describe, it, expect } from "vitest";
import { ConversationProjector } from "../ConversationProjector.js";
import type { OutputEvent } from "../contract/events/index.js";

function userMsg(text: string): OutputEvent {
  return { type: "user.message", persist: true, seq: 1, text, conversationId: "c1", ts: "t" };
}
function delta(text: string): OutputEvent {
  return { type: "assistant.delta", kind: "text", text, conversationId: "c1", ts: "t" };
}
function assistantMsg(text: string): OutputEvent {
  return { type: "assistant.message", persist: true, seq: 1, text, conversationId: "c1", ts: "t" };
}
function turnStart(): OutputEvent {
  return { type: "turn-start", persist: true, seq: 1, turnSeq: 1, conversationId: "c1", ts: "t" };
}

describe("ConversationProjector（OutputEvent → 消息列表）", () => {
  it("实时流式 delta 累积，turn-end 收口成 assistant 消息", () => {
    const p = new ConversationProjector();
    p.apply(turnStart());
    p.apply(delta("深秋"));
    p.apply(delta("的风。"));
    p.apply({ type: "turn-end", persist: true, seq: 1, turnSeq: 1, conversationId: "c1", ts: "t" });
    expect(p.getMessages()).toEqual([{ role: "assistant", text: "深秋的风。" }]);
  });

  it("journal 历史重放：user.message + assistant.message", () => {
    const p = new ConversationProjector();
    p.applyAll([userMsg("写个开头"), assistantMsg("好的，这是开头。")]);
    expect(p.getMessages()).toEqual([
      { role: "user", text: "写个开头" },
      { role: "assistant", text: "好的，这是开头。" },
    ]);
  });

  it("忽略 turn-start/tool-call 等边界事件", () => {
    const p = new ConversationProjector();
    p.apply(turnStart());
    p.apply({ type: "tool-call-request", persist: true, seq: 1, toolCallId: "t1", name: "Read", args: "{}", conversationId: "c1", ts: "t" });
    expect(p.getMessages()).toHaveLength(0);
  });

  it("delta 无 turn-end 收口时保留在缓冲（不产出消息）", () => {
    const p = new ConversationProjector();
    p.apply(delta("半句"));
    expect(p.getMessages()).toHaveLength(0);
    p.apply({ type: "turn-end", persist: true, seq: 1, turnSeq: 1, conversationId: "c1", ts: "t" });
    expect(p.getMessages()).toEqual([{ role: "assistant", text: "半句" }]);
  });
});
