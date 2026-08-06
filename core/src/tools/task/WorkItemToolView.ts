/** Role-bound Work-Item Tool view composition (Main/Team versus Ephemeral). */
import {
  ToolRegistry,
  ToolRegistryAssembler,
} from "../../tooling/registry/index.js";

export type WorkItemToolViewRole = "main" | "team_member" | "ephemeral";

export interface WorkItemToolViewOptions {
  readonly role: WorkItemToolViewRole;
  readonly taskRegistry: ToolRegistry;
  readonly todoRegistry: ToolRegistry;
}

/**
 * Main Agents and Team members receive Work-Item Task Tools plus the
 * TodoWrite fallback. Ephemeral Subagent views receive TodoWrite only:
 * Task Tools never enter an Ephemeral Registry View.
 */
export function createWorkItemToolView(
  options: WorkItemToolViewOptions,
): ToolRegistry {
  if (options.role === "ephemeral") {
    return options.todoRegistry;
  }
  const assembler = new ToolRegistryAssembler();
  assembler.merge(options.taskRegistry).merge(options.todoRegistry);
  return assembler.freeze();
}
