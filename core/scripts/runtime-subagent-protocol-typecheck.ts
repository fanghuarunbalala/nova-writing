/** Compile-time examples for provider-neutral Subagent lifecycle contracts. */
import {
  SUBAGENT_LIMITS,
  captureSubagentBinding,
  captureSubagentRequest,
  captureSubagentResult,
  type SubagentBinding,
  type SubagentRequest,
  type SubagentResult,
} from "../src/index.js";

declare const request: SubagentRequest;
declare const binding: SubagentBinding;
declare const result: SubagentResult;
void captureSubagentRequest(request);
void captureSubagentBinding(binding);
void captureSubagentResult(result, binding);
void SUBAGENT_LIMITS.maximumActiveGlobal;
