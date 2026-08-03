import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  PromptAssemblyBuilder,
  PromptAssemblyError,
  PromptCapabilitySnapshot,
  RuntimePromptAssembler,
  SystemPromptBuilder,
  createDefaultPromptSectionRegistry,
  novelAgentDefinition,
} from "../dist/index.js";

class Sha256PromptDigester {
  algorithm = "sha256";

  async digest(content) {
    return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
  }
}

const digester = new Sha256PromptDigester();
const promptBuilder = new SystemPromptBuilder({
  sections: createDefaultPromptSectionRegistry(),
  digester,
});
const basePrompt = await promptBuilder.build({
  definition: novelAgentDefinition,
  capabilities: new PromptCapabilitySnapshot([{
    name: "TodoWrite",
    version: "1.0.0",
    label: "Todo Write",
    description: "Maintains the current execution plan.",
  }]),
});
const assembler = new RuntimePromptAssembler(new PromptAssemblyBuilder({ digester }));

const message = {
  id: "message:user-1",
  conversationId: "conversation:assembly",
  role: "user",
  messageType: "user.message",
  schemaVersion: 1,
  timestamp: "2026-08-03T00:00:00.000Z",
  runId: "run:1",
  payload: {
    content: [{ type: "text", text: "Hello" }],
  },
};

const request = {
  conversationId: "conversation:assembly",
  runId: "run:1",
  basePrompt,
  checkpointOverlays: [{
    kind: "checkpoint",
    sourceId: "checkpoint:latest",
    layer: "checkpoint",
    persistence: "checkpoint",
    order: 1,
    content: "Checkpoint overlay",
  }],
  nudgeOverlays: [{
    kind: "nudge",
    sourceId: "nudge:turn-close",
    layer: "nudge",
    persistence: "one_shot",
    order: 1,
    content: "Nudge overlay",
  }],
  messages: [message],
  messageHighWatermark: 1,
};

const assembly = await assembler.assemble(request);
assert.equal(assembly.conversationId, request.conversationId);
assert.equal(assembly.runId, request.runId);
assert.deepEqual(
  assembly.overlays.map((overlay) => overlay.sourceId),
  ["checkpoint:latest", "nudge:turn-close"],
);
assert.match(assembly.systemPrompt, /Checkpoint overlay/);
assert.match(assembly.systemPrompt, /Nudge overlay/);
assert.equal(assembly.messages.length, 1);
assert.equal(assembly.messages[0].id, message.id);
assert.ok(Object.isFrozen(assembly));
assert.ok(Object.isFrozen(assembly.messages));
assert.ok(Object.isFrozen(assembly.messages[0]));
assert.match(assembly.digest, /^sha256:[0-9a-f]{64}$/);

const repeatedAssembly = await assembler.assemble(request);
assert.equal(repeatedAssembly.digest, assembly.digest);
assert.equal(repeatedAssembly.overlays[0].digest, assembly.overlays[0].digest);

const changedAssembly = await assembler.assemble({
  ...request,
  nudgeOverlays: [{
    ...request.nudgeOverlays[0],
    content: "Changed nudge overlay",
  }],
});
assert.notEqual(changedAssembly.digest, assembly.digest);

await assert.rejects(
  () => assembler.assemble({
    ...request,
    messages: [{ ...message, conversationId: "conversation:other" }],
  }),
  (error) => {
    assert.ok(error instanceof PromptAssemblyError);
    assert.equal(error.failure, "conversation_mismatch");
    return true;
  },
);

await assert.rejects(
  () => assembler.assemble({
    ...request,
    nudgeOverlays: [{
      ...request.nudgeOverlays[0],
      sourceId: "nudge:duplicate",
    }, {
      ...request.nudgeOverlays[0],
      sourceId: "nudge:duplicate",
      order: 2,
    }],
  }),
  (error) => {
    assert.ok(error instanceof PromptAssemblyError);
    assert.equal(error.failure, "duplicate_contribution");
    return true;
  },
);

console.log("prompt assembly smoke: passed");
