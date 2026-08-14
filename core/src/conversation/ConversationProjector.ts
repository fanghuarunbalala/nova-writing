/**
 * 对话投影器：把 LoopEvent 流（实时 delta + journal 历史）投影成消息列表视图。
 * 纯逻辑、可测；供 UI 对话界面消费（T12 投影层核心）。
 */
import type { LoopEvent } from "../runtime/loop/types.js";

/** 对话消息视图（UI 消费） */
export interface ConversationMessageView {
  /** 角色 */
  role: "user" | "assistant";
  /** 文本内容 */
  text: string;
}

/** 对话投影器：累积 OutputEvent → 消息列表 */
export class ConversationProjector {
  /** 已投影的消息 */
  private messages: ConversationMessageView[] = [];
  /** 流式 assistant 文本缓冲（delta 累积，assistant.message 时收口） */
  private assistantBuffer = "";

  /**
   * 应用一条 LoopEvent（实时 delta 或 journal 历史）
   * @param event 输出事件
   */
  apply(event: LoopEvent): void {
    switch (event.type) {
      case "user.message":
        this.messages.push({ role: "user", text: event.text });
        break;
      case "assistant.delta":
        // 实时流式增量：累积到缓冲
        this.assistantBuffer += event.text;
        break;
      case "assistant.message":
        // journal 历史完整消息：直接产出（text 有内容）
        if (event.text) this.messages.push({ role: "assistant", text: event.text });
        break;
      case "turn-end":
        // 实时流收口：flush 缓冲（delta 累积的完整回复）
        if (this.assistantBuffer) {
          this.messages.push({ role: "assistant", text: this.assistantBuffer });
          this.assistantBuffer = "";
        }
        break;
      // turn-start、tool-call、compacted/clear 等对最小对话无影响，忽略
    }
  }

  /** 批量应用（journal history 重放） */
  applyAll(events: Iterable<LoopEvent>): void {
    for (const e of events) this.apply(e);
  }

  /** 当前消息列表 */
  getMessages(): readonly ConversationMessageView[] {
    return this.messages;
  }
}
