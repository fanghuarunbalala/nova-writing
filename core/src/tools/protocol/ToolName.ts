/** Canonical provider-facing Tool identity uses PascalCase without separators. */
export const TOOL_NAME_PATTERN = /^[A-Z][A-Za-z0-9]{0,63}$/;

export function isToolName(value: unknown): value is string {
  return typeof value === "string" && TOOL_NAME_PATTERN.test(value);
}
