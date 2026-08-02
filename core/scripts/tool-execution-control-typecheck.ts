/** Compile-only proof of cancellation and persisted Tool Trace contracts. */
import type {
  ToolCancelResult,
  ToolDispatcher,
  ToolTraceSink,
} from "../src/tools/index.js";

declare const dispatcher: ToolDispatcher;
declare const traceSink: ToolTraceSink;
declare const result: ToolCancelResult;

void dispatcher.cancel("tool-call-1");
void traceSink;

// @ts-expect-error Cancellation outcomes are immutable.
result.outcome = "not_found";
