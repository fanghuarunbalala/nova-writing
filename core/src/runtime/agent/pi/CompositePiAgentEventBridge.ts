/** Sequentially composes private Pi event bridges into one awaited subscriber. */
import type { PiAgentEventBridge, PiAgentEventBridgeRequest } from "./PiAgentEventBridge.js";

export class CompositePiAgentEventBridge implements PiAgentEventBridge {
  private readonly bridges: readonly PiAgentEventBridge[];

  constructor(bridges: readonly PiAgentEventBridge[]) {
    if (!Array.isArray(bridges) || bridges.length === 0) {
      throw new TypeError("Pi Agent event bridge list must not be empty");
    }
    this.bridges = Object.freeze([...bridges]);
  }

  async handle(request: PiAgentEventBridgeRequest): Promise<void> {
    for (const bridge of this.bridges) await bridge.handle(request);
  }
}
