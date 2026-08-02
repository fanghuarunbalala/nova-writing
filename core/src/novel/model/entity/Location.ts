/** Stable Location identity and progressively completed profile state. */
import { captureLocationId, type LocationId } from "../../identity/index.js";
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

export interface Location extends StableEntityProfile {
  readonly id: LocationId;
  readonly entityVersion: NovelEntityVersion;
  readonly createdAt: NovelTimestamp;
  readonly updatedAt: NovelTimestamp;
}

export function captureLocation(value: Location): Location {
  return Object.freeze({
    id: captureLocationId(value.id),
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
