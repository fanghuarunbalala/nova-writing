/**
 * context.reliability 通用段：上下文可信度规则（跨域共享）。
 * Generic section: context reliability rules (shared across domains).
 */
import { PromptSection } from "../../section/PromptSection.js";

export class ContextReliabilityPromptSection extends PromptSection {
  constructor() {
    super({
      id: "context.reliability",
      version: "1.0.0",
      label: "Context Reliability",
    });
  }

  render(): string {
    return [
      "Treat current Runtime state and Tool results as more authoritative than remembered earlier text.",
      "Do not invent missing persisted state, Tool results, configuration, or user decisions.",
      "When context is incomplete, state the uncertainty and obtain the missing information through available capabilities.",
    ].join("\n");
  }
}
