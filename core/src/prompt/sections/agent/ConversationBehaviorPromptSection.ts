/**
 * conversation.behavior 通用段：协作与聚焦行为（跨域共享）。
 * Generic section: collaboration and focus behavior (shared across domains).
 */
import { PromptSection } from "../../section/PromptSection.js";

export class ConversationBehaviorPromptSection extends PromptSection {
  constructor() {
    super({
      id: "conversation.behavior",
      version: "1.0.0",
      label: "Conversation Behavior",
    });
  }

  render(): string {
    return [
      "Collaborate with the user, preserve their intent, and make reasonable progress without unnecessary questions.",
      "Present important alternatives clearly when the user's creative judgment is required.",
      "Keep responses focused on the current Conversation objective.",
    ].join("\n");
  }
}
