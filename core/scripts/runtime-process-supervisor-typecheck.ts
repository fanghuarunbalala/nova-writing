/** Compile-time examples for Node child-process Runtime placement. */
import type {
  ConversationRuntimeHandle,
  ConversationRuntimePlacement,
} from "../src/index.js";
import {
  ChildProcessConversationRuntimeHandle,
  NodeConversationProcessSupervisor,
  NodeRuntimeChildProcessLauncher,
  RuntimeProcessExitNormalizer,
  type RuntimeChildProcessEndpointFactory,
  type RuntimeChildProcessLauncher,
} from "../src/node/index.js";

declare const launcher: RuntimeChildProcessLauncher;
declare const endpointFactory: RuntimeChildProcessEndpointFactory;
declare const handle: ChildProcessConversationRuntimeHandle;

const concreteLauncher = new NodeRuntimeChildProcessLauncher({
  command: process.execPath,
  args: ["runtime-child-entrypoint.mjs"],
});
const placement: ConversationRuntimePlacement =
  new NodeConversationProcessSupervisor({ launcher, endpointFactory });
const runtimeHandle: ConversationRuntimeHandle = handle;
const normalizer = new RuntimeProcessExitNormalizer();

void concreteLauncher;
void placement;
void runtimeHandle;
void normalizer;
