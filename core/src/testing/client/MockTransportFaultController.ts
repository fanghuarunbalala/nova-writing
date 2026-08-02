/** Deterministic disconnect and duplicate-delivery controls for Mock Transports. */
export type MockTransportDisconnectListener = () => void;

export class MockTransportDisconnectedError extends Error {
  readonly code = "MOCK_TRANSPORT_DISCONNECTED";

  constructor(public readonly transportKind: string) {
    super("Mock Transport is disconnected");
    this.name = "MockTransportDisconnectedError";
  }
}

export class MockTransportFaultController {
  private connected = true;
  private duplicateDeliveryCount = 0;
  private readonly disconnectListeners = new Set<MockTransportDisconnectListener>();

  get isConnected(): boolean {
    return this.connected;
  }

  disconnect(): void {
    if (!this.connected) return;
    this.connected = false;
    for (const listener of [...this.disconnectListeners]) listener();
  }

  reconnect(): void {
    this.connected = true;
  }

  duplicateNextEventDelivery(count = 1): void {
    if (!Number.isSafeInteger(count) || count < 1) {
      throw new TypeError("Mock duplicate delivery count must be a positive integer");
    }
    this.duplicateDeliveryCount += count;
  }

  assertConnected(transportKind: string): void {
    if (!this.connected) throw new MockTransportDisconnectedError(transportKind);
  }

  takeDuplicateDeliveryCount(): number {
    const count = this.duplicateDeliveryCount;
    this.duplicateDeliveryCount = 0;
    return count;
  }

  onDisconnect(listener: MockTransportDisconnectListener): () => void {
    this.disconnectListeners.add(listener);
    return () => {
      this.disconnectListeners.delete(listener);
    };
  }
}
