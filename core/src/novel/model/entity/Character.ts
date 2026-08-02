/** Stable Character identity and progressively completed profile state. */
import {
  captureCharacterId,
  type CharacterId,
} from "../../identity/index.js";
import {
  captureNovelEntityVersion,
  captureNovelTimestamp,
  type NovelEntityVersion,
  type NovelTimestamp,
} from "../../version/index.js";
import {
  captureStableEntityProfile,
  type StableEntityProfile,
} from "./StableEntityProfile.js";

export interface Character extends StableEntityProfile {
  readonly id: CharacterId;
  readonly entityVersion: NovelEntityVersion;
  readonly createdAt: NovelTimestamp;
  readonly updatedAt: NovelTimestamp;
}

export function captureCharacter(value: Character): Character {
  return Object.freeze({
    id: captureCharacterId(value.id),
    ...captureStableEntityProfile({
      name: value.name,
      aliases: value.aliases,
      ...(value.summary === undefined ? {} : { summary: value.summary }),
      ...(value.initialState === undefined
        ? {}
        : { initialState: value.initialState }),
      ...(value.authorNotes === undefined
        ? {}
        : { authorNotes: value.authorNotes }),
    }),
    entityVersion: captureNovelEntityVersion(value.entityVersion),
    createdAt: captureNovelTimestamp(value.createdAt),
    updatedAt: captureNovelTimestamp(value.updatedAt),
  });
}
