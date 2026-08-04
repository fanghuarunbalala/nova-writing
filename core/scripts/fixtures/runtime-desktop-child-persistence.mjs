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
      throw new Error("invalid desktop child persistence input");
    }
  }

  async shutdown(request) {
    this.resolveExit({
      kind: "stopped",
      exitedAt: "2026-08-04T08:00:02.000Z",
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
      const page = await context.persistence.journal.listEvents({
        conversationId: bootstrap.conversation.metadata.id,
        anchor: { from: "start" },
        limit: 10,
      });
      if (page.events.length !== 1 || page.events[0].id !== "journal-event-1") {
        throw new Error("unexpected journal payload");
      }
      const messages = await context.persistence.messages.list({
        conversationId: bootstrap.conversation.metadata.id,
        afterMessageIndex: 0,
        highWatermarkMessageIndex: 1,
      });
      if (messages.items.length !== 0) {
        throw new Error("unexpected messages payload");
      }
      return new FixtureRuntime(bootstrap);
    },
  },
});
