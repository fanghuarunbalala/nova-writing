export const EVENT_SCHEMA_VERSION = 1 as const;

export interface EventMetadata {
  id: string;
  conversationId: string;
  eventType: string;
  schemaVersion: number;
  timestamp: string;
  correlationId?: string;
  causationId?: string;
  runId?: string;
  turnId?: string;
}

export interface EventCreationOptions {
  id?: string;
  timestamp?: string;
  correlationId?: string;
  causationId?: string;
  runId?: string;
  turnId?: string;
}
