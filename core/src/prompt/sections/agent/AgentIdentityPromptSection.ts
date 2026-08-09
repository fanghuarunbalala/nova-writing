/**
 * agent.identity 通用段：当前 agent 身份（类型/标签/描述）。
 * Generic section: current agent identity (type/label/description).
 */
import { PromptSection } from "../../section/PromptSection.js";
import type { PromptContext } from "../../PromptContext.js";

export class AgentIdentityPromptSection extends PromptSection {
  constructor() {
    super({
      id: "agent.identity",
      version: "1.0.0",
      label: "Agent Identity",
    });
  }

  render(context: PromptContext): string {
    return [
      `Agent type: ${context.definition.agentType}`,
      `Agent label: ${context.definition.label}`,
      context.definition.description,
    ].join("\n");
  }
}
