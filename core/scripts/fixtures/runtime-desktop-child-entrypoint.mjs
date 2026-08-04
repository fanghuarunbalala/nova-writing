import { createDefaultApplicationConfiguration } from "../../dist/index.js";
import { runDesktopRuntimeChildEntrypoint } from "../../dist/node/index.js";

await runDesktopRuntimeChildEntrypoint({
  application: {
    async load() {
      return createDefaultApplicationConfiguration().toSnapshot();
    },
    async save() {},
  },
  credentials: {
    async use(reference, operation) {
      return operation(`secret-${reference}`);
    },
    async getStatus() {
      return "configured";
    },
    async save() {},
    async delete() {},
  },
  adapterFactory: {
    async create({ lifecycleController }) {
      return {
        stream: async (request) => {
          await lifecycleController.beginTurn();
          await lifecycleController.transitionTurn({
            current: "completed",
            reason: "turn_completed",
          });
          return Object.freeze({
            conversationId: request.conversationId,
            runId: request.runId,
            outcome: "completed",
          });
        },
        cancel: async () => undefined,
      };
    },
  },
});
