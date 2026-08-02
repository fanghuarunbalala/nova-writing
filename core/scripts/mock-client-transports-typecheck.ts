/** Compile-only proof that both Mock adapters satisfy the shared Transport boundary. */
import type { ApiTransport } from "../src/index.js";
import {
  DeterministicMockNovelHost,
  MockElectronApiTransport,
  MockHttpWebSocketApiTransport,
} from "../src/testing/index.js";

const host = new DeterministicMockNovelHost();
const electron: ApiTransport = new MockElectronApiTransport({ host });
const web: ApiTransport = new MockHttpWebSocketApiTransport({ host });

void electron;
void web;
