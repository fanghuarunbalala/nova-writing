/** Compile-only proof of immutable, Provider-neutral Tool execution contracts. */
import type {
  CapturedToolInvocation,
  ToolExecutionPolicy,
  ToolTraceRecord,
} from "../src/tools/index.js";

declare const invocation: CapturedToolInvocation;
declare const policy: ToolExecutionPolicy;
declare const trace: ToolTraceRecord;

// @ts-expect-error Captured arguments cannot be replaced.
invocation.arguments = {};
// @ts-expect-error Cancellation is mandatory in the initial execution contract.
const invalidPolicy: ToolExecutionPolicy = { ...policy, cancellable: false };
// @ts-expect-error Trace records never expose raw Tool arguments.
void trace.arguments;

void invalidPolicy;
