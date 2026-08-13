import { describe, it, expect, vi } from "vitest";
import { ConversationProjector } from "../ConversationProjector.js";
import type { ConversationHandle } from "../contract/handle/index.js";
import type { OutputEvent } from "../contract/events/index.js";

/** renderer 对话客户端逻辑（头测，不依赖 Electron DOM） */
class ConversationClient {
  private readonly projector = new ConversationProjector();
  private readonly handle: ConversationHandle;

  constructor(handle: ConversationHandle) {
    this.handle = handle;
  }

  /** 订阅事件流（投影累积） */
  async start(): Promise<void> {
    await this.handle.subscribeEvents((evt) => this.projector.apply(evt));
  }

  /** 发消息（经 handle） */
  send(text: string): Promise<unknown> {
    return this.handle.sendUserMessage({ text });
  }

  /** 当前消息视图 */
  getMessages(): readonly { role: string; text: string }[] {
    return this.projector.getMessages();
  }
}

function makeHandle(): { handle: ConversationHandle; sendUserMessage: ReturnType<typeof vi.fn> } {
  const sendUserMessage = vi.fn().mockResolvedValue({ seq: 1, recordedAt: "t" });
  const handle: ConversationHandle = {
    sendUserMessage,
    sendUserCommand: async () => ({ seq: 0, recordedAt: "t" }),
    sendSystemControl: async () => ({ seq: 0, recordedAt: "t" }),
    subscribeEvents: async () => {},
    resolveApproval: () => {},
    resolveQuestion: () => {},
    resolveExitCompose: () => {},
    dispose: () => {},
    sendApprovalRequest: async () => ({ kind: "approve" }),
    sendAskingQuestionRequest: async () => "",
    sendExitComposeRequest: async () => {},
  };
  return { handle, sendUserMessage };
}

describe("ConversationClient（renderer 对话逻辑头测）", () => {
  it("send 经 handle.sendUserMessage 发消息", async () => {
    const { handle, sendUserMessage } = makeHandle();
    const client = new ConversationClient(handle);
    await client.send("写个开头");
    expect(sendUserMessage).toHaveBeenCalledWith({ text: "写个开头" });
  });

  it("投影器处理事件流（delta 累积 + turn-end 收口）", () => {
    const projector = new ConversationProjector();
    const events: OutputEvent[] = [
      { type: "assistant.delta", persist: false, kind: "text", text: "深", conversationId: "c1", ts: "t" },
      { type: "assistant.delta", persist: false, kind: "text", text: "秋", conversationId: "c1", ts: "t" },
      { type: "turn-end", persist: true, seq: 1, turnSeq: 1, conversationId: "c1", ts: "t" },
    ];
    projector.applyAll(events);
    expect(projector.getMessages()).toEqual([{ role: "assistant", text: "深秋" }]);
  });
});
