/** Resolves the durable task list identity for one caller context. */
import type { TaskListContext, TaskListResolver } from "./TaskProtocol.js";

export interface StaticTaskListResolverOptions {
  readonly conversationId: string;
  readonly teamName?: string;
}

export class StaticTaskListResolver implements TaskListResolver {
  constructor(
    private readonly resolveFn: (context: TaskListContext) => string,
  ) {}

  resolve(context: TaskListContext): Promise<string> {
    return Promise.resolve(this.resolveFn(context));
  }
}

/**
 * Default resolution: a Team member uses the shared team list; every other
 * caller uses its own Conversation list (Team = TaskList).
 */
export function resolveTaskListId(context: TaskListContext): string {
  const conversationId = requireIdentity(context.conversationId, "Conversation ID");
  const teamName = context.teamName?.trim();
  if (teamName !== undefined && teamName.length > 0) {
    return requireIdentity(sanitizeTeamListId(teamName), "Team name");
  }
  return conversationId;
}

export const defaultTaskListResolver: TaskListResolver =
  new StaticTaskListResolver(resolveTaskListId);

function sanitizeTeamListId(teamName: string): string {
  return teamName.replace(/[^A-Za-z0-9_-]/g, "-");
}

function requireIdentity(value: string, label: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > 512
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}
