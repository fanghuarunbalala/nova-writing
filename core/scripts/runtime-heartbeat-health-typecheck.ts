/** Compile-time examples for heartbeat health and process termination policy. */
import {
  RuntimeIpcHeartbeatEmitter,
  RuntimeIpcHeartbeatMonitor,
  type RuntimeIpcHealthState,
} from "../src/index.js";
import type { ChildProcessConversationRuntimeHandle } from "../src/node/index.js";

declare const emitter: RuntimeIpcHeartbeatEmitter;
declare const monitor: RuntimeIpcHeartbeatMonitor;
declare const handle: ChildProcessConversationRuntimeHandle;
const state: RuntimeIpcHealthState = monitor.state;
void emitter;
void handle;
void state;
