import { runNodeRuntimeChildEntrypoint } from "../../dist/node/index.js";

class CrashingRuntime {
  constructor(bootstrap) {
    this.conversationId = bootstrap.conversation.metadata.id;
    this.runtimeInstanceId = bootstrap.runtimeInstanceId;
    this.exit = new Promise((resolve) => { this.resolveExit = resolve; });
  }
  async start(bootstrap) {
    setTimeout(() => this.resolveExit({
      kind: "crashed",
      exitedAt: "2026-08-02T00:00:04.000Z",
      errorName: "FixtureRuntimeCrash",
      errorCode: "FIXTURE_RUNTIME_CRASH",
    }), 50);
    return { throughSequence: bootstrap.journal.highWatermark };
  }
  async dispatchInput() {}
  async shutdown(request) {
    this.resolveExit({ kind: "stopped", exitedAt: "2026-08-02T00:00:05.000Z", reason: request.reason });
  }
  waitForExit() { return this.exit; }
}

await runNodeRuntimeChildEntrypoint({
  compositionFactory: {
    async create(bootstrap) { return new CrashingRuntime(bootstrap); },
  },
});
