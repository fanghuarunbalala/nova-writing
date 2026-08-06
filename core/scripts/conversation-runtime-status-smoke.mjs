import assert from "node:assert/strict";
import {
  CONVERSATION_RUNTIME_STATUS,
  classifyConversationRuntimeStatus,
} from "../dist/index.js";

function presence(state) {
  return Object.freeze({ state, observedAt: "2026-08-04T11:00:00.000Z" });
}

const cases = [
  [{ presence: presence("starting") }, CONVERSATION_RUNTIME_STATUS.starting],
  [{ presence: presence("online") }, CONVERSATION_RUNTIME_STATUS.online],
  [
    { presence: presence("online"), runStatus: "running" },
    CONVERSATION_RUNTIME_STATUS.generating,
  ],
  [
    { presence: presence("online"), turnStatus: "waiting_tool" },
    CONVERSATION_RUNTIME_STATUS.generating,
  ],
  [
    // Provider failures are Turn failures: presence stays online, not crashed.
    { presence: presence("online"), runStatus: "failed" },
    CONVERSATION_RUNTIME_STATUS.online,
  ],
  [{ presence: presence("stopping") }, CONVERSATION_RUNTIME_STATUS.stopped],
  [{ presence: presence("offline") }, CONVERSATION_RUNTIME_STATUS.stopped],
  [
    { presence: presence("crashed"), failureCode: "model_profile_unselected" },
    CONVERSATION_RUNTIME_STATUS.notConfigured,
  ],
  [
    { presence: presence("crashed"), failureCode: "model_connection_disabled" },
    CONVERSATION_RUNTIME_STATUS.invalidConfiguration,
  ],
  [
    { presence: presence("crashed"), failureCode: "credential_missing" },
    CONVERSATION_RUNTIME_STATUS.missingCredential,
  ],
  [
    { presence: presence("crashed"), failureCode: "agent_manifest_mismatch" },
    CONVERSATION_RUNTIME_STATUS.missingManifest,
  ],
  [
    {
      presence: presence("crashed"),
      presenceReason: "activation_failed",
    },
    CONVERSATION_RUNTIME_STATUS.crashed,
  ],
  [
    { presence: presence("crashed"), failureCode: "rate_limit" },
    CONVERSATION_RUNTIME_STATUS.crashed,
  ],
];

for (const [input, expected] of cases) {
  assert.equal(
    classifyConversationRuntimeStatus(input),
    expected,
    JSON.stringify(input),
  );
}

console.log("Conversation Runtime status smoke passed");
