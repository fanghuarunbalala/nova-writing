/**
 * Provider-neutral desktop Runtime status view combining logical Presence,
 * live Run/Turn state, and stable failure codes.
 */
import type {
  RuntimePresence,
} from "../../conversation/index.js";
import type { RuntimePresenceChangeReason } from "../../event/output/payload/RuntimePresenceChangedPayload.js";
import type { RunStatus } from "./RunLifecycle.js";
import type { TurnStatus } from "./TurnLifecycle.js";

export const CONVERSATION_RUNTIME_STATUS = {
  notConfigured: "not_configured",
  invalidConfiguration: "invalid_configuration",
  missingCredential: "missing_credential",
  missingManifest: "missing_manifest",
  starting: "starting",
  online: "online",
  generating: "generating",
  stopped: "stopped",
  crashed: "crashed",
} as const;

export type ConversationRuntimeStatus =
  (typeof CONVERSATION_RUNTIME_STATUS)[keyof typeof CONVERSATION_RUNTIME_STATUS];

export const CONVERSATION_RUNTIME_NOT_CONFIGURED_FAILURES = Object.freeze([
  "application_configuration_missing",
  "configuration_unavailable",
  "model_profile_unselected",
  "model_profile_missing",
  "model_connection_missing",
  "desktop_conversation_runtime_unavailable",
] as const);

export const CONVERSATION_RUNTIME_INVALID_CONFIGURATION_FAILURES =
  Object.freeze([
    "model_connection_disabled",
    "model_api_unsupported",
    "unsupported_api",
  ] as const);

export const CONVERSATION_RUNTIME_MISSING_CREDENTIAL_FAILURES =
  Object.freeze([
    "credential_reference_missing",
    "credential_missing",
    "credential_unavailable",
    "auth",
  ] as const);

export const CONVERSATION_RUNTIME_MISSING_MANIFEST_FAILURES =
  Object.freeze([
    "agent_manifest_missing",
    "agent_manifest_mismatch",
    "manifest_binding_missing",
    "manifest_missing",
    "manifest_mismatch",
  ] as const);

export interface ConversationRuntimeStatusInput {
  readonly presence: RuntimePresence;
  readonly presenceReason?: RuntimePresenceChangeReason;
  readonly runStatus?: RunStatus;
  readonly turnStatus?: TurnStatus;
  readonly failureCode?: string;
}

export function classifyConversationRuntimeStatus(
  input: ConversationRuntimeStatusInput,
): ConversationRuntimeStatus {
  switch (input.presence.state) {
    case "starting":
      return CONVERSATION_RUNTIME_STATUS.starting;
    case "online":
      return isGenerating(input.runStatus, input.turnStatus)
        ? CONVERSATION_RUNTIME_STATUS.generating
        : CONVERSATION_RUNTIME_STATUS.online;
    case "stopping":
      return CONVERSATION_RUNTIME_STATUS.stopped;
    case "crashed":
      return classifyCrashed(input.failureCode, input.presenceReason);
    case "offline":
      return CONVERSATION_RUNTIME_STATUS.stopped;
  }
}

function isGenerating(
  runStatus: RunStatus | undefined,
  turnStatus: TurnStatus | undefined,
): boolean {
  return (
    runStatus === "running" ||
    runStatus === "waiting_interaction" ||
    runStatus === "stopping" ||
    turnStatus === "running" ||
    turnStatus === "waiting_tool" ||
    turnStatus === "waiting_interaction" ||
    turnStatus === "stopping"
  );
}

function classifyCrashed(
  failureCode: string | undefined,
  presenceReason: RuntimePresenceChangeReason | undefined,
): ConversationRuntimeStatus {
  if (failureCode === undefined && presenceReason !== "activation_failed") {
    return CONVERSATION_RUNTIME_STATUS.crashed;
  }
  const code = failureCode ?? "activation_failed";
  if (includes(CONVERSATION_RUNTIME_NOT_CONFIGURED_FAILURES, code)) {
    return CONVERSATION_RUNTIME_STATUS.notConfigured;
  }
  if (includes(CONVERSATION_RUNTIME_INVALID_CONFIGURATION_FAILURES, code)) {
    return CONVERSATION_RUNTIME_STATUS.invalidConfiguration;
  }
  if (includes(CONVERSATION_RUNTIME_MISSING_CREDENTIAL_FAILURES, code)) {
    return CONVERSATION_RUNTIME_STATUS.missingCredential;
  }
  if (includes(CONVERSATION_RUNTIME_MISSING_MANIFEST_FAILURES, code)) {
    return CONVERSATION_RUNTIME_STATUS.missingManifest;
  }
  return CONVERSATION_RUNTIME_STATUS.crashed;
}

function includes(
  list: readonly string[],
  value: string,
): boolean {
  return list.includes(value);
}
