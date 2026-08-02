/** HTTP request plus WebSocket Event-shaped Mock Transport over the shared Host. */
import type { Logger } from "../../observability/index.js";
import type { DeterministicMockNovelHost } from "./DeterministicMockNovelHost.js";
import { MockHostApiTransport } from "./MockHostApiTransport.js";
import type { MockTransportFaultController } from "./MockTransportFaultController.js";

export interface MockHttpWebSocketApiTransportOptions {
  readonly host: DeterministicMockNovelHost;
  readonly faultController?: MockTransportFaultController;
  readonly logger?: Logger;
}

export class MockHttpWebSocketApiTransport extends MockHostApiTransport {
  constructor(options: MockHttpWebSocketApiTransportOptions) {
    super({
      ...options,
      transportKind: "http-websocket",
    });
  }
}
