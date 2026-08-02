/** Electron IPC-shaped Mock Transport backed by the shared deterministic Host. */
import type { Logger } from "../../observability/index.js";
import type { DeterministicMockNovelHost } from "./DeterministicMockNovelHost.js";
import { MockHostApiTransport } from "./MockHostApiTransport.js";
import type { MockTransportFaultController } from "./MockTransportFaultController.js";

export interface MockElectronApiTransportOptions {
  readonly host: DeterministicMockNovelHost;
  readonly faultController?: MockTransportFaultController;
  readonly logger?: Logger;
}

export class MockElectronApiTransport extends MockHostApiTransport {
  constructor(options: MockElectronApiTransportOptions) {
    super({
      ...options,
      transportKind: "electron-ipc",
    });
  }
}
