/** Compile-time examples for process-free Subagent TaskGet and completion reconciliation. */
import {
  SubagentCompletionBridge,
  SubagentTaskQueryService,
  type SubagentBinding,
  type SubagentTaskLimits,
  type SubagentResult,
} from "../src/index.js";

declare const binding: SubagentBinding;
declare const limits: SubagentTaskLimits;
declare const result: SubagentResult;

const bindings = {
  async get() { return binding; },
  async list() { return [binding]; },
  async put() {},
  subscribe() { throw new Error("not implemented"); },
};

const query = new SubagentTaskQueryService({
  bindings,
  runtimePresence: {
    async getRuntimePresence() {
      return { state: "offline" as const, observedAt: "2026-08-03T00:00:00.000Z" };
    },
  },
  finalAssistantMessages: {
    async readFinalAssistantMessage() {
      return undefined;
    },
  },
  limits,
});

const bridge = new SubagentCompletionBridge({
  bindings,
  finalAssistantMessages: {
    async readFinalAssistantMessage() {
      return undefined;
    },
  },
  resultSink: {
    async deliverResult(value) {
      return value;
    },
  },
});

void bridge;
void result;
