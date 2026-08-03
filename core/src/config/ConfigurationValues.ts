/** Shared validation and freezing helpers for immutable Configuration value objects. */

export type JsonScalar = string | number | boolean;

export function captureIdentity(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

export function captureNonBlank(
  value: unknown,
  label: string,
  maximumLength = 1_024,
): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maximumLength
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value.trim();
}

export function captureOptionalNonBlank(
  value: unknown,
  label: string,
  maximumLength = 4_096,
): string | undefined {
  return value === undefined
    ? undefined
    : captureNonBlank(value, label, maximumLength);
}

export function captureBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${label} is invalid`);
  return value;
}

export function captureInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as number;
}

export function captureNumber(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

export function captureOptionalInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number | undefined {
  return value === undefined
    ? undefined
    : captureInteger(value, label, minimum, maximum);
}

export function captureOptionalNumber(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number | undefined {
  return value === undefined
    ? undefined
    : captureNumber(value, label, minimum, maximum);
}

export function captureStringList(
  value: unknown,
  label: string,
  maximumItems = 128,
): readonly string[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new TypeError(`${label} is invalid`);
  }
  const seen = new Set<string>();
  return Object.freeze(value.map((item) => {
    const captured = captureNonBlank(item, label);
    if (seen.has(captured)) throw new TypeError(`${label} must be unique`);
    seen.add(captured);
    return captured;
  }));
}

export function captureIdentityList(
  value: unknown,
  label: string,
  maximumItems = 128,
): readonly string[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new TypeError(`${label} is invalid`);
  }
  const seen = new Set<string>();
  return Object.freeze(value.map((item) => {
    const captured = captureIdentity(item, label);
    if (seen.has(captured)) throw new TypeError(`${label} must be unique`);
    seen.add(captured);
    return captured;
  }));
}

export function captureScalarRecord(
  value: unknown,
  label: string,
): Readonly<Record<string, JsonScalar>> {
  if (value === undefined) return Object.freeze({});
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  const captured: Record<string, JsonScalar> = {};
  for (const [key, entry] of Object.entries(value)) {
    const capturedKey = captureNonBlank(key, `${label} key`, 128);
    if (
      typeof entry !== "string" &&
      typeof entry !== "number" &&
      typeof entry !== "boolean"
    ) {
      throw new TypeError(`${label} value is invalid`);
    }
    captured[capturedKey] = entry;
  }
  return Object.freeze(captured);
}

export function captureStringRecord(
  value: unknown,
  label: string,
): Readonly<Record<string, string>> {
  if (value === undefined) return Object.freeze({});
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  const captured: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    const capturedKey = captureNonBlank(key, `${label} key`, 128);
    captured[capturedKey] = captureNonBlank(entry, `${label} value`, 4_096);
  }
  return Object.freeze(captured);
}

export function freezeSnapshot<TValue extends object>(value: TValue): TValue {
  return Object.freeze(value);
}
