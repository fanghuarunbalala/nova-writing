/** Shared strict validation for progressively completed stable entity profiles. */
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../../error/index.js";

export interface StableEntityProfile {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly summary?: string;
  readonly initialState?: string;
  readonly authorNotes?: string;
}

const PROFILE_KEYS = new Set([
  "name",
  "aliases",
  "summary",
  "initialState",
  "authorNotes",
]);

export function captureStableEntityProfile(
  value: StableEntityProfile,
): StableEntityProfile {
  if (
    value === null ||
    typeof value !== "object" ||
    Object.keys(value).some((key) => !PROFILE_KEYS.has(key)) ||
    !Array.isArray(value.aliases) ||
    value.aliases.length > 32
  ) {
    throw invalidProfile();
  }
  const name = captureLabel(value.name, 200);
  const aliases = value.aliases.map((alias) => captureLabel(alias, 200));
  const normalizedAliases = aliases.map((alias) => alias.toLowerCase());
  if (
    new Set(normalizedAliases).size !== normalizedAliases.length ||
    normalizedAliases.includes(name.toLowerCase())
  ) {
    throw invalidProfile();
  }
  return Object.freeze({
    name,
    aliases: Object.freeze(aliases),
    ...captureOptional("summary", value.summary, 20_000),
    ...captureOptional("initialState", value.initialState, 20_000),
    ...captureOptional("authorNotes", value.authorNotes, 50_000),
  });
}

function captureLabel(value: unknown, maximumLength: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    value.trim() !== value ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value)
  ) {
    throw invalidProfile();
  }
  return value;
}

function captureOptional(
  key: "summary" | "initialState" | "authorNotes",
  value: unknown,
  maximumLength: number,
): Partial<StableEntityProfile> {
  if (value === undefined) return {};
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    value.trim().length === 0 ||
    /\u0000/u.test(value)
  ) {
    throw invalidProfile();
  }
  return { [key]: value };
}

function invalidProfile(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidOperation,
    "entityProfile",
  );
}
