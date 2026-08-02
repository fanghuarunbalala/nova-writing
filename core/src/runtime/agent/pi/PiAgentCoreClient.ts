/** Minimal structural subset of Pi Agent used by the internal Core adapter. */
import type {
  Agent,
  AgentEvent,
  AgentMessage,
  StreamFn,
} from "@earendil-works/pi-agent-core";

export interface PiAgentCoreState {
  systemPrompt: string;
  readonly model: {
    readonly id: string;
    readonly api: string;
    readonly provider: string;
  };
  messages: AgentMessage[];
  readonly errorMessage?: string;
}

export interface PiAgentCoreClient {
  readonly state: PiAgentCoreState;
  streamFunction: StreamFn;

  subscribe(
    listener: (event: AgentEvent, signal: AbortSignal) => Promise<void> | void,
  ): () => void;

  prompt(message: AgentMessage | AgentMessage[]): Promise<void>;

  continue(): Promise<void>;

  abort(): void;

  waitForIdle(): Promise<void>;
}

/** Compile-time compatibility boundary for the installed Pi Agent API. */
export function asPiAgentCoreClient(agent: Agent): PiAgentCoreClient {
  return agent;
}
