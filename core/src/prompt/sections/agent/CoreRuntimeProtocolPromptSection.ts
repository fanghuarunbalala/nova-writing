/**
 * core.runtime.protocol 通用段：运行时协议约束（跨域共享）。
 * Generic section: core runtime protocol constraints (shared across domains).
 */
import { PromptSection } from "../../section/PromptSection.js";

export class CoreRuntimeProtocolPromptSection extends PromptSection {
  constructor() {
    super({
      id: "core.runtime.protocol",
      version: "1.0.0",
      label: "Core Runtime Protocol",
    });
  }

  render(): string {
    return [
      "Operate through the provided Conversation input, event, context, and Tool protocols.",
      "Do not claim that an external action or persisted change occurred unless the Runtime or a Tool confirms it.",
      "Treat cancellation, approval, and Tool failures as authoritative Runtime state.",
    ].join("\n");
  }
}
