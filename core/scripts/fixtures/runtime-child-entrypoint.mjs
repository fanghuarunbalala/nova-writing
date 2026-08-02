import {
  runNodeRuntimeChildEntrypoint,
} from "../../dist/node/index.js";

class FixtureRuntime {
  constructor(bootstrap) {
    this.conversationId = bootstrap.conversation.metadata.id;
    this.runtimeInstanceId = bootstrap.runtimeInstanceId;
    this.exitPromise = new Promise((resolve) => {
      this.resolveExit = resolve;
    });
  }

  async start(bootstrap) {
    return {
      conversationId: this.conversationId,
      runtimeInstanceId: this.runtimeInstanceId,
      activationReason: bootstrap.activation.reason,
      throughSequence: bootstrap.journal.highWatermark,
      scannedEventCount: 0,
      processedInputCount: 0,
      outcomeRepairCount: 0,
      routedInputCount: 0,
    };
  }

  async dispatchInput(input) {
    if (input.conversationId !== this.conversationId || input.sequence < 1) {
      throw new Error("invalid fixture input");
    }
  }

  async shutdown(request) {
    this.resolveExit({
      kind: "stopped",
      exitedAt: "2026-08-02T00:00:02.000Z",
      reason: request.reason,
    });
  }

  waitForExit() {
    return this.exitPromise;
  }
}

await runNodeRuntimeChildEntrypoint({
  compositionFactory: {
    async create(bootstrap, context) {
      if (!context.persistence?.journal || !context.persistence?.runtimeState) {
        throw new Error("Missing Runtime persistence composition context");
      }
      return new FixtureRuntime(bootstrap);
    },
  },
});
