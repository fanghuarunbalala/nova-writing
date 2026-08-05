/** Compile-time contract examples for the provider request debug recorder. */
import {
  PiProviderExecutionFactory,
  captureProviderRequestDebugSnapshot,
  type ProviderRequestDebugRecorder,
  type ProviderRequestDebugSnapshot,
} from "../src/runtime/agent/pi/index.js";
import { createNodeProviderRequestDebugRecorder } from "../src/node/index.js";

const recorder: ProviderRequestDebugRecorder =
  createNodeProviderRequestDebugRecorder({ path: "debug.jsonl" });
void recorder;

declare const snapshot: ProviderRequestDebugSnapshot;
void snapshot.model.id;
void snapshot.config.modelProfileId;
void snapshot.messages;
void snapshot.tools;
void snapshot.prompt;

void captureProviderRequestDebugSnapshot;
void PiProviderExecutionFactory;
