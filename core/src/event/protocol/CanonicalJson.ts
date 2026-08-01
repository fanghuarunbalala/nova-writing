import { isJsonValue, type JsonValue } from "./JsonValue.js";

export function canonicalStringifyJson(value: JsonValue): string {
  if (!isJsonValue(value)) {
    throw new TypeError("Value must be finite, acyclic, and JSON-safe");
  }

  return stringifyCanonicalValue(value);
}

function stringifyCanonicalValue(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stringifyCanonicalValue(item)).join(",")}]`;
  }

  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stringifyCanonicalValue(value[key]!)}`);
  return `{${entries.join(",")}}`;
}
