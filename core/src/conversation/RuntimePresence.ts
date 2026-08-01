/** Logical Runtime availability without PID, transport, or placement details. */
export const RUNTIME_PRESENCE_STATE = {
  offline: "offline",
  starting: "starting",
  online: "online",
  stopping: "stopping",
  crashed: "crashed",
} as const;

export type RuntimePresenceState =
  (typeof RUNTIME_PRESENCE_STATE)[keyof typeof RUNTIME_PRESENCE_STATE];

export interface RuntimePresence {
  readonly state: RuntimePresenceState;
  readonly observedAt: string;
}

export function isRuntimePresenceState(value: unknown): value is RuntimePresenceState {
  return (
    typeof value === "string" &&
    Object.values(RUNTIME_PRESENCE_STATE).some((state) => state === value)
  );
}
