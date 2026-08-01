const RUNTIME_MESSAGE_TYPE_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/;

export function isRuntimeMessageType(value: string): boolean {
  return RUNTIME_MESSAGE_TYPE_PATTERN.test(value);
}
