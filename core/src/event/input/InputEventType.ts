export const INPUT_EVENT_TYPE = {
  userMessage: "user.message",
  systemStop: "system.stop",
  reloadConfig: "command.config.reload",
  clearContext: "context.clear",
  compactContext: "context.compact",
} as const;

export type CoreInputEventType = (typeof INPUT_EVENT_TYPE)[keyof typeof INPUT_EVENT_TYPE];
