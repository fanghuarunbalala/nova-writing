/** Stable Core OutputEvent type names shared by publishers and consumers. */
export const OUTPUT_EVENT_TYPE = {
  runtimePresenceChanged: "system.runtime.presence.changed",
  hostInputRouted: "system.input.routed",
  agentRunStateChanged: "agent.run.state.changed",
  agentTurnStateChanged: "agent.turn.state.changed",
} as const;

export type CoreOutputEventType =
  (typeof OUTPUT_EVENT_TYPE)[keyof typeof OUTPUT_EVENT_TYPE];
