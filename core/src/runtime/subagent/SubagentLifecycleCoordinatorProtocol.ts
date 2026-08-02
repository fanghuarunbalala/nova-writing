/** Public lifecycle handle and retry-stable parent projection identity Port. */
import type { SubagentBinding, SubagentRequest, SubagentResult } from "./SubagentProtocol.js";

export interface SubagentLifecycleEventIdFactory {
  create(input: {
    readonly parentConversationId: string;
    readonly parentRunId: string;
    readonly subagentId: string;
    readonly eventType: string;
    readonly ordinal: number;
  }): string;
}

export interface SubagentLifecycleClock {
  now(): string;
}

export interface SubagentLifecycleHandle {
  readonly binding: SubagentBinding;
  readonly result: Promise<SubagentResult>;
}

export interface SubagentProgressReport {
  readonly subagentId: string;
  readonly progressCode: string;
  readonly reportedAt?: string;
}

export interface SubagentLifecycleCoordinator {
  start(request: SubagentRequest): Promise<SubagentLifecycleHandle>;

  reportProgress(report: SubagentProgressReport): Promise<void>;

  deliverResult(result: SubagentResult): Promise<SubagentResult>;

  waitForResult(subagentId: string): Promise<SubagentResult>;
}
