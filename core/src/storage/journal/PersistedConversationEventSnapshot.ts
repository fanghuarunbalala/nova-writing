import type {
  InputEventSnapshot,
  OutputEventSnapshot,
  PersistedEventSnapshot,
} from "../../event/index.js";

export type PersistedInputEventSnapshot = PersistedEventSnapshot<
  InputEventSnapshot,
  "input"
>;

export type PersistedOutputEventSnapshot = PersistedEventSnapshot<
  OutputEventSnapshot,
  "output"
>;

export type PersistedConversationEventSnapshot =
  | PersistedInputEventSnapshot
  | PersistedOutputEventSnapshot;
