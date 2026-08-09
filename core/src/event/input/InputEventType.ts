export const INPUT_EVENT_TYPE = {
  userMessage: "user.message",
  taskAssigned: "system.subagent.task.assigned",
  systemStop: "system.stop",
  reloadConfig: "command.config.reload",
  clearContext: "context.clear",
  compactContext: "context.compact",
  approvalDecision: "command.tool.approval.decision",
  conversationModeSet: "conversation.mode.set",
} as const;

export type CoreInputEventType = (typeof INPUT_EVENT_TYPE)[keyof typeof INPUT_EVENT_TYPE];

export function isAgentTurnInputEventType(eventType: string): boolean {
  return eventType === INPUT_EVENT_TYPE.userMessage ||
    eventType === INPUT_EVENT_TYPE.taskAssigned;
}
