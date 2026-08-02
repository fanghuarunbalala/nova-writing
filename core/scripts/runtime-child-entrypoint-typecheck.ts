/** Compile-time examples for negotiated Parent/Child Runtime composition. */
import type { ConversationRuntimePlacement } from "../src/index.js";
import {
  NodeConversationProcessSupervisor,
  NodeRuntimeChildProcessLauncher,
  ParentRuntimeChildEndpointFactory,
  RuntimeChildEntrypoint,
  type RuntimeChildCompositionFactory,
} from "../src/node/index.js";

declare const compositionFactory: RuntimeChildCompositionFactory;
declare const entrypoint: RuntimeChildEntrypoint;

const launcher = new NodeRuntimeChildProcessLauncher({
  command: process.execPath,
  args: ["runtime-child-entrypoint.mjs"],
});
const placement: ConversationRuntimePlacement =
  new NodeConversationProcessSupervisor({
    launcher,
    endpointFactory: new ParentRuntimeChildEndpointFactory(),
  });

void compositionFactory;
void entrypoint;
void placement;
