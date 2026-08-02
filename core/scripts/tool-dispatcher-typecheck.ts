/** Compile-only proof of Provider-neutral Dispatcher and Sandbox contracts. */
import type {
  SandboxExecutor,
  ToolApprovalRequestFactory,
  ToolDispatcher,
} from "../src/tools/index.js";

declare const dispatcher: ToolDispatcher;
declare const sandbox: SandboxExecutor;
declare const approvalFactory: ToolApprovalRequestFactory;

void dispatcher;
void approvalFactory;

// @ts-expect-error Sandbox capabilities are immutable declarations.
sandbox.capabilities.isolation = "os_process";
