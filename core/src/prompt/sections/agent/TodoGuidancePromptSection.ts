/**
 * todo.guidance 通用段：TodoWrite 使用约定（要求 TodoWrite 能力）。
 * Generic section: TodoWrite usage conventions (requires the TodoWrite capability).
 */
import { PromptSection } from "../../section/PromptSection.js";
import type { PromptContext } from "../../PromptContext.js";

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
