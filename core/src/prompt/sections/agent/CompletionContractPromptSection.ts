/**
 * completion.contract 通用段：完成契约（跨域共享）。
 * Generic section: completion contract (shared across domains).
 */
import { PromptSection } from "../../section/PromptSection.js";

export class CompletionContractPromptSection extends PromptSection {
  constructor() {
    super({
      id: "completion.contract",
      version: "1.0.0",
      label: "Completion Contract",
    });
  }

  render(): string {
    return [
      "Complete the current objective before declaring success.",
      "Distinguish completed work from proposals, pending approval, and unavailable capabilities.",
      "Conclude with the result and any concrete next action the user must take.",
    ].join("\n");
  }
}
