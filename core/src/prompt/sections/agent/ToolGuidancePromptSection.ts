/**
 * tool.guidance 通用段：可用工具清单与用法指引（跨域共享）。
 * Generic section: available tools list and usage guidance (shared across domains).
 */
import { PromptSection } from "../../section/PromptSection.js";
import type { PromptContext } from "../../PromptContext.js";

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
        (tool) => renderToolGuidance(tool),
      ),
      "Use only the listed Tools and follow each Tool schema exactly.",
    ].join("\n");
  }
}

function renderToolGuidance(tool: PromptContext["capabilities"]["tools"][number]): string {
  const lines = [`- ${tool.name}@${tool.version}: ${tool.description}`];
  if (tool.promptDetails?.usage !== undefined) {
    lines.push(`  Usage: ${tool.promptDetails.usage}`);
  }
  if (tool.promptDetails?.parameterGuidance !== undefined) {
    lines.push(`  Parameters: ${tool.promptDetails.parameterGuidance}`);
  }
  if (tool.promptDetails?.safetyGuidance !== undefined) {
    lines.push(`  Safety: ${tool.promptDetails.safetyGuidance}`);
  }
  return lines.join("\n");
}
