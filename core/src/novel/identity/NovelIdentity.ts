/** Opaque Novel infrastructure identities and their shared safe capture boundary. */
import {
  NOVEL_PROTOCOL_FAILURE,
  NovelProtocolValidationError,
} from "../error/index.js";

declare const novelIdBrand: unique symbol;
declare const novelDraftSessionIdBrand: unique symbol;
declare const novelOperationIdBrand: unique symbol;
declare const novelCommitIdBrand: unique symbol;
declare const novelConflictIdBrand: unique symbol;
declare const novelArtifactIdBrand: unique symbol;
declare const characterIdBrand: unique symbol;
declare const locationIdBrand: unique symbol;
declare const storyOutlineIdBrand: unique symbol;
declare const storyUnitIdBrand: unique symbol;
declare const storyEventStepIdBrand: unique symbol;
declare const rhythmBeatIdBrand: unique symbol;

export type NovelId = string & { readonly [novelIdBrand]: "NovelId" };
export type NovelDraftSessionId = string & {
  readonly [novelDraftSessionIdBrand]: "NovelDraftSessionId";
};
export type NovelOperationId = string & {
  readonly [novelOperationIdBrand]: "NovelOperationId";
};
export type NovelCommitId = string & {
  readonly [novelCommitIdBrand]: "NovelCommitId";
};
export type NovelConflictId = string & {
  readonly [novelConflictIdBrand]: "NovelConflictId";
};
export type NovelArtifactId = string & {
  readonly [novelArtifactIdBrand]: "NovelArtifactId";
};
export type CharacterId = string & { readonly [characterIdBrand]: "CharacterId" };
export type LocationId = string & { readonly [locationIdBrand]: "LocationId" };
export type StoryOutlineId = string & {
  readonly [storyOutlineIdBrand]: "StoryOutlineId";
};
export type StoryUnitId = string & {
  readonly [storyUnitIdBrand]: "StoryUnitId";
};
export type StoryEventStepId = string & {
  readonly [storyEventStepIdBrand]: "StoryEventStepId";
};
export type RhythmBeatId = string & {
  readonly [rhythmBeatIdBrand]: "RhythmBeatId";
};

const SAFE_IDENTITY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;

export function captureNovelId(value: unknown): NovelId {
  return captureIdentity("novelId", value) as NovelId;
}

export function captureNovelDraftSessionId(value: unknown): NovelDraftSessionId {
  return captureIdentity("draftSessionId", value) as NovelDraftSessionId;
}

export function captureNovelOperationId(value: unknown): NovelOperationId {
  return captureIdentity("operationId", value) as NovelOperationId;
}

export function captureNovelCommitId(value: unknown): NovelCommitId {
  return captureIdentity("commitId", value) as NovelCommitId;
}

export function captureNovelConflictId(value: unknown): NovelConflictId {
  return captureIdentity("conflictId", value) as NovelConflictId;
}

export function captureNovelArtifactId(value: unknown): NovelArtifactId {
  return captureIdentity("artifactId", value) as NovelArtifactId;
}

export function captureCharacterId(value: unknown): CharacterId {
  return captureIdentity("characterId", value) as CharacterId;
}

export function captureLocationId(value: unknown): LocationId {
  return captureIdentity("locationId", value) as LocationId;
}

export function captureStoryOutlineId(value: unknown): StoryOutlineId {
  return captureIdentity("storyOutlineId", value) as StoryOutlineId;
}

export function captureStoryUnitId(value: unknown): StoryUnitId {
  return captureIdentity("storyUnitId", value) as StoryUnitId;
}

export function captureStoryEventStepId(value: unknown): StoryEventStepId {
  return captureIdentity("storyEventStepId", value) as StoryEventStepId;
}

export function captureRhythmBeatId(value: unknown): RhythmBeatId {
  return captureIdentity("rhythmBeatId", value) as RhythmBeatId;
}

function captureIdentity(field: string, value: unknown): string {
  if (typeof value !== "string" || !SAFE_IDENTITY_PATTERN.test(value)) {
    throw new NovelProtocolValidationError(
      NOVEL_PROTOCOL_FAILURE.invalidIdentity,
      field,
    );
  }
  return value;
}
