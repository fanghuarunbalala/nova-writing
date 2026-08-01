/** Stable Core OutputEvent type names shared by publishers and consumers. */
export const OUTPUT_EVENT_TYPE = {
  runtimePresenceChanged: "system.runtime.presence.changed",
  hostInputRouted: "system.input.routed",
  runtimeInputProcessed: "system.input.processed",
  agentRunStateChanged: "agent.run.state.changed",
  agentTurnStateChanged: "agent.turn.state.changed",
  agentAssistantMessageStarted: "agent.assistant.message.started",
  agentAssistantMessageDelta: "agent.assistant.message.delta",
  agentAssistantMessageCompleted: "agent.assistant.message.completed",
  agentAssistantMessageFailed: "agent.assistant.message.failed",
  agentAssistantMessageCancelled: "agent.assistant.message.cancelled",
} as const;

export type CoreOutputEventType =
  (typeof OUTPUT_EVENT_TYPE)[keyof typeof OUTPUT_EVENT_TYPE];
