/** Reusable generic Prompt Sections shared by all initial Agent Definitions. */
import type { PromptContext } from "../PromptContext.js";
import { PromptSection } from "../section/PromptSection.js";
import {
  PromptSectionRegistry,
  PromptSectionRegistryAssembler,
} from "../section/PromptSectionRegistry.js";

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

export class ToolGuidancePromptSection extends PromptSection {
  constructor() {
    super({
      id: "tool.guidance",
      version: "1.0.0",
      label: "Tool Guidance",
    });
  }

  render(context: PromptContext): string {
    if (context.capabilities.tools.length === 0) {
      return "No Tools are available in this Agent Manifest. Do not simulate Tool execution.";
    }
    return [
      "Available Tools:",
      ...context.capabilities.tools.map(
        (tool) => `- ${tool.name}@${tool.version}: ${tool.description}`,
      ),
      "Use only the listed Tools and follow each Tool schema exactly.",
    ].join("\n");
  }
}

export class TodoGuidancePromptSection extends PromptSection {
  constructor() {
    super({
      id: "todo.guidance",
      version: "1.0.0",
      label: "Todo Guidance",
    });
  }

  render(context: PromptContext): string {
    const hasTodoWrite = context.capabilities.tools.some(
      (tool) => tool.name === "TodoWrite",
    );
    if (!hasTodoWrite) {
      throw new TypeError("Todo Guidance requires the TodoWrite capability");
    }
    return [
      "Use TodoWrite for non-trivial multi-step work, not for simple questions.",
      "Keep stable Todo IDs, at most one in-progress item, and update status as work advances.",
      "A Todo list is Runtime execution state, not domain data or Conversation history.",
    ].join("\n");
  }
}

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

export function createDefaultPromptSectionRegistry(): PromptSectionRegistry {
  return new PromptSectionRegistryAssembler()
    .register(new CoreRuntimeProtocolPromptSection())
    .register(new AgentIdentityPromptSection())
    .register(new ConversationBehaviorPromptSection())
    .register(new ToolGuidancePromptSection())
    .register(new TodoGuidancePromptSection())
    .register(new ContextReliabilityPromptSection())
    .register(new CompletionContractPromptSection())
    .freeze();
}
