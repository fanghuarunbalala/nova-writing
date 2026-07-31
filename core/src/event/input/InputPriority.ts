export const INPUT_PRIORITY = {
  system: 1000,
  command: 900,
  user: 500,
  context: 400,
} as const;

export type InputPriority = (typeof INPUT_PRIORITY)[keyof typeof INPUT_PRIORITY];
