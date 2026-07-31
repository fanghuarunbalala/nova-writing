export type EventKind = "input" | "output";

const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/;

export function isEventType(value: string): boolean {
  return EVENT_TYPE_PATTERN.test(value);
}
