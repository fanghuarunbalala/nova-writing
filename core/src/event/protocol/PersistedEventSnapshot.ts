import type { EventKind } from "./EventType.js";

export type PersistedEventSnapshot<
  TEvent extends object,
  TDirection extends EventKind,
> = TEvent & {
  direction: TDirection;
  sequence: number;
  recordedAt: string;
};
