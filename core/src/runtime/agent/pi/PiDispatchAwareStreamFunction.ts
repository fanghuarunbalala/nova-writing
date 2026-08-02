/** Private Pi Provider stream contract with an exact dispatch lifecycle hook. */
import type { StreamFn } from "@earendil-works/pi-agent-core";

export interface PiProviderDispatchHooks {
  /** Call immediately after the Provider request has actually been sent. */
  onDispatched(dispatchedAt?: string): Promise<void>;

  /** Call when execution terminates before any Provider request was sent. */
  onFailedBeforeDispatch(failedAt?: string): Promise<void>;
}

export type PiDispatchAwareStreamFunction = (
  model: Parameters<StreamFn>[0],
  context: Parameters<StreamFn>[1],
  options: Parameters<StreamFn>[2],
  hooks: PiProviderDispatchHooks,
) => ReturnType<StreamFn>;

export interface PiProviderCallIdentityInput {
  readonly conversationId: string;
  readonly runId: string;
  readonly turnNumber: number;
  readonly providerCallOrdinal: number;
}

export interface PiProviderCallIdFactory {
  create(input: PiProviderCallIdentityInput): string;
}

export class RandomPiProviderCallIdFactory implements PiProviderCallIdFactory {
  create(_input: PiProviderCallIdentityInput): string {
    return `provider_call_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
  }
}

export interface PiProviderCallClock {
  now(): string;
}

export const systemPiProviderCallClock: PiProviderCallClock = Object.freeze({
  now: () => new Date().toISOString(),
});
