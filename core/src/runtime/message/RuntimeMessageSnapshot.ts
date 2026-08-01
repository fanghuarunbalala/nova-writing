/**
 * Core-owned model message envelope persisted by the repairable Message
 * projection. Pi-specific message types are converted only inside adapters.
 */
import type { JsonObject } from "../../event/index.js";
import type { RuntimeMessageRole } from "./RuntimeMessageRole.js";

export const RUNTIME_MESSAGE_SCHEMA_VERSION = 1 as const;

export interface RuntimeMessageDraft {
  role: RuntimeMessageRole;
  messageType: string;
  schemaVersion: number;
  timestamp: string;
  runId?: string;
  turnId?: string;
  payload: JsonObject;
}

export interface RuntimeMessageSnapshot extends RuntimeMessageDraft {
  id: string;
  conversationId: string;
}
