export const RUNTIME_MESSAGE_ROLE = {
  user: "user",
  assistant: "assistant",
  tool: "tool",
  system: "system",
  custom: "custom",
} as const;

export type RuntimeMessageRole =
  (typeof RUNTIME_MESSAGE_ROLE)[keyof typeof RUNTIME_MESSAGE_ROLE];

export function isRuntimeMessageRole(value: string): value is RuntimeMessageRole {
  return Object.values(RUNTIME_MESSAGE_ROLE).some((role) => role === value);
}
