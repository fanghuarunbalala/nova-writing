/** Captures planned Character and Location participation for one StoryUnit. */
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../../error/index.js";
import {
  captureCharacterId,
  captureLocationId,
  captureStoryUnitId,
  type CharacterId,
  type LocationId,
  type StoryUnitId,
} from "../../identity/index.js";

export const CHARACTER_PRESENCE = {
  present: "present",
  offstage: "offstage",
  mentioned: "mentioned",
} as const;
export type CharacterPresence =
  (typeof CHARACTER_PRESENCE)[keyof typeof CHARACTER_PRESENCE];

export const CHARACTER_STORY_ROLE = {
  pointOfView: "point-of-view",
  participant: "participant",
  observer: "observer",
  affected: "affected",
} as const;
export type CharacterStoryRole =
  (typeof CHARACTER_STORY_ROLE)[keyof typeof CHARACTER_STORY_ROLE];

export const LOCATION_STORY_ROLE = {
  primary: "primary",
  secondary: "secondary",
  mentioned: "mentioned",
} as const;
export type LocationStoryRole =
  (typeof LOCATION_STORY_ROLE)[keyof typeof LOCATION_STORY_ROLE];

export interface CharacterInvolvement {
  readonly presence: CharacterPresence;
  readonly roles: readonly CharacterStoryRole[];
}

export interface LocationInvolvement {
  readonly role: LocationStoryRole;
  readonly affected: boolean;
}

export interface StoryUnitCharacterBinding {
  readonly storyUnitId: StoryUnitId;
  readonly characterId: CharacterId;
  readonly involvement?: CharacterInvolvement;
  readonly note?: string;
}

export interface StoryUnitLocationBinding {
  readonly storyUnitId: StoryUnitId;
  readonly locationId: LocationId;
  readonly involvement?: LocationInvolvement;
  readonly note?: string;
}

const CHARACTER_BINDING_KEYS = new Set([
  "storyUnitId",
  "characterId",
  "involvement",
  "note",
]);
const LOCATION_BINDING_KEYS = new Set([
  "storyUnitId",
  "locationId",
  "involvement",
  "note",
]);
const CHARACTER_INVOLVEMENT_KEYS = new Set(["presence", "roles"]);
const LOCATION_INVOLVEMENT_KEYS = new Set(["role", "affected"]);
const CHARACTER_PRESENCES = new Set<unknown>(Object.values(CHARACTER_PRESENCE));
const CHARACTER_ROLES = new Set<unknown>(Object.values(CHARACTER_STORY_ROLE));
const LOCATION_ROLES = new Set<unknown>(Object.values(LOCATION_STORY_ROLE));

export function captureCharacterInvolvement(
  value: unknown,
): CharacterInvolvement {
  const candidate = captureExactObject(value, CHARACTER_INVOLVEMENT_KEYS, true);
  if (!CHARACTER_PRESENCES.has(candidate.presence) || !Array.isArray(candidate.roles)) {
    throw invalidStoryBinding();
  }
  const roles = candidate.roles.map((role) => {
    if (!CHARACTER_ROLES.has(role)) throw invalidStoryBinding();
    return role as CharacterStoryRole;
  });
  if (new Set(roles).size !== roles.length) throw invalidStoryBinding();
  if (
    roles.includes(CHARACTER_STORY_ROLE.pointOfView) &&
    candidate.presence !== CHARACTER_PRESENCE.present
  ) {
    throw invalidStoryBinding();
  }
  return Object.freeze({
    presence: candidate.presence as CharacterPresence,
    roles: Object.freeze(roles),
  });
}

export function captureLocationInvolvement(
  value: unknown,
): LocationInvolvement {
  const candidate = captureExactObject(value, LOCATION_INVOLVEMENT_KEYS, true);
  if (!LOCATION_ROLES.has(candidate.role) || typeof candidate.affected !== "boolean") {
    throw invalidStoryBinding();
  }
  return Object.freeze({
    role: candidate.role as LocationStoryRole,
    affected: candidate.affected,
  });
}

export function captureStoryUnitCharacterBinding(
  value: unknown,
): StoryUnitCharacterBinding {
  const candidate = captureExactObject(value, CHARACTER_BINDING_KEYS, false);
  const involvement =
    candidate.involvement === undefined
      ? undefined
      : captureCharacterInvolvement(candidate.involvement);
  const note = captureOptionalNote(candidate.note);
  return Object.freeze({
    storyUnitId: captureStoryUnitId(candidate.storyUnitId),
    characterId: captureCharacterId(candidate.characterId),
    ...(involvement === undefined ? {} : { involvement }),
    ...(note === undefined ? {} : { note }),
  });
}

export function captureStoryUnitLocationBinding(
  value: unknown,
): StoryUnitLocationBinding {
  const candidate = captureExactObject(value, LOCATION_BINDING_KEYS, false);
  const involvement =
    candidate.involvement === undefined
      ? undefined
      : captureLocationInvolvement(candidate.involvement);
  const note = captureOptionalNote(candidate.note);
  return Object.freeze({
    storyUnitId: captureStoryUnitId(candidate.storyUnitId),
    locationId: captureLocationId(candidate.locationId),
    ...(involvement === undefined ? {} : { involvement }),
    ...(note === undefined ? {} : { note }),
  });
}

export function captureStoryUnitCharacterBindings(
  storyUnitIdInput: StoryUnitId,
  value: unknown,
): readonly StoryUnitCharacterBinding[] {
  const storyUnitId = captureStoryUnitId(storyUnitIdInput);
  if (!Array.isArray(value)) throw invalidStoryBinding();
  const bindings = value.map(captureStoryUnitCharacterBinding);
  const characterIds = new Set<CharacterId>();
  for (const binding of bindings) {
    if (
      binding.storyUnitId !== storyUnitId ||
      characterIds.has(binding.characterId)
    ) {
      throw invalidStoryBinding();
    }
    characterIds.add(binding.characterId);
  }
  return Object.freeze(
    bindings.sort((left, right) => left.characterId.localeCompare(right.characterId)),
  );
}

export function captureStoryUnitLocationBindings(
  storyUnitIdInput: StoryUnitId,
  value: unknown,
): readonly StoryUnitLocationBinding[] {
  const storyUnitId = captureStoryUnitId(storyUnitIdInput);
  if (!Array.isArray(value)) throw invalidStoryBinding();
  const bindings = value.map(captureStoryUnitLocationBinding);
  const locationIds = new Set<LocationId>();
  for (const binding of bindings) {
    if (binding.storyUnitId !== storyUnitId || locationIds.has(binding.locationId)) {
      throw invalidStoryBinding();
    }
    locationIds.add(binding.locationId);
  }
  return Object.freeze(
    bindings.sort((left, right) => left.locationId.localeCompare(right.locationId)),
  );
}

function captureExactObject(
  value: unknown,
  keys: ReadonlySet<string>,
  requireEveryKey: boolean,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (requireEveryKey && Object.keys(value).length !== keys.size) ||
    Object.keys(value).some((key) => !keys.has(key))
  ) {
    throw invalidStoryBinding();
  }
  return value as Record<string, unknown>;
}

function captureOptionalNote(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 20_000 ||
    value.trim().length === 0 ||
    /\u0000/u.test(value)
  ) {
    throw invalidStoryBinding();
  }
  return value;
}

function invalidStoryBinding(): NovelProtocolValidationError {
  return new NovelProtocolValidationError(
    NOVEL_PROTOCOL_FAILURE.invalidStoryBinding,
    "storyBinding",
  );
}
