/** Immutable provider-neutral Runtime configuration for one assembled Agent Conversation. */
import type { AgentAssembly, AgentAssemblySnapshot } from "../../agent/manifest/index.js";

export const AGENT_RUNTIME_CONFIGURATION_SCHEMA_VERSION = 1 as const;

export interface AgentRuntimePolicyReferencesSnapshot {
  readonly runtimePolicyId: string;
  readonly contextPolicyId: string;
  readonly nudgePolicyId: string;
}

export class AgentRuntimePolicyReferences {
  readonly runtimePolicyId: string;
  readonly contextPolicyId: string;
  readonly nudgePolicyId: string;

  constructor(options: AgentRuntimePolicyReferencesSnapshot) {
    this.runtimePolicyId = captureIdentity(
      options.runtimePolicyId,
      "Runtime policy ID",
    );
    this.contextPolicyId = captureIdentity(
      options.contextPolicyId,
      "Context policy ID",
    );
    this.nudgePolicyId = captureIdentity(options.nudgePolicyId, "Nudge policy ID");
    Object.freeze(this);
  }

  toSnapshot(): AgentRuntimePolicyReferencesSnapshot {
    return Object.freeze({
      runtimePolicyId: this.runtimePolicyId,
      contextPolicyId: this.contextPolicyId,
      nudgePolicyId: this.nudgePolicyId,
    });
  }
}

export interface AgentRuntimeExecutionLimitsSnapshot {
  readonly maximumTurns: number;
  readonly maximumProviderCallsPerTurn: number;
  readonly maximumToolCallsPerTurn: number;
  readonly providerCallTimeoutMs: number;
  readonly toolExecutionTimeoutMs: number;
}

export class AgentRuntimeExecutionLimits {
  readonly maximumTurns: number;
  readonly maximumProviderCallsPerTurn: number;
  readonly maximumToolCallsPerTurn: number;
  readonly providerCallTimeoutMs: number;
  readonly toolExecutionTimeoutMs: number;

  constructor(options: AgentRuntimeExecutionLimitsSnapshot) {
    this.maximumTurns = capturePositiveInteger(options.maximumTurns, "maximumTurns");
    this.maximumProviderCallsPerTurn = capturePositiveInteger(
      options.maximumProviderCallsPerTurn,
      "maximumProviderCallsPerTurn",
    );
    this.maximumToolCallsPerTurn = capturePositiveInteger(
      options.maximumToolCallsPerTurn,
      "maximumToolCallsPerTurn",
    );
    this.providerCallTimeoutMs = capturePositiveInteger(
      options.providerCallTimeoutMs,
      "providerCallTimeoutMs",
    );
    this.toolExecutionTimeoutMs = capturePositiveInteger(
      options.toolExecutionTimeoutMs,
      "toolExecutionTimeoutMs",
    );
    Object.freeze(this);
  }

  toSnapshot(): AgentRuntimeExecutionLimitsSnapshot {
    return Object.freeze({
      maximumTurns: this.maximumTurns,
      maximumProviderCallsPerTurn: this.maximumProviderCallsPerTurn,
      maximumToolCallsPerTurn: this.maximumToolCallsPerTurn,
      providerCallTimeoutMs: this.providerCallTimeoutMs,
      toolExecutionTimeoutMs: this.toolExecutionTimeoutMs,
    });
  }
}

export interface AgentRuntimeConfigurationOptions {
  readonly conversationId: string;
  readonly assembly: AgentAssembly;
  readonly policies: AgentRuntimePolicyReferences;
  readonly limits: AgentRuntimeExecutionLimits;
}

export interface AgentRuntimeConfigurationSnapshot {
  readonly schemaVersion: typeof AGENT_RUNTIME_CONFIGURATION_SCHEMA_VERSION;
  readonly conversationId: string;
  readonly assembly: AgentAssemblySnapshot;
  readonly policies: AgentRuntimePolicyReferencesSnapshot;
  readonly limits: AgentRuntimeExecutionLimitsSnapshot;
}

export class AgentRuntimeConfiguration {
  readonly schemaVersion = AGENT_RUNTIME_CONFIGURATION_SCHEMA_VERSION;
  readonly conversationId: string;
  readonly assembly: AgentAssembly;
  readonly policies: AgentRuntimePolicyReferences;
  readonly limits: AgentRuntimeExecutionLimits;

  constructor(options: AgentRuntimeConfigurationOptions) {
    this.conversationId = captureIdentity(options.conversationId, "Conversation ID");
    if (!isAgentAssembly(options.assembly)) {
      throw new TypeError("Runtime Agent Assembly is invalid");
    }
    if (!(options.policies instanceof AgentRuntimePolicyReferences)) {
      throw new TypeError("Runtime policy references are invalid");
    }
    if (!(options.limits instanceof AgentRuntimeExecutionLimits)) {
      throw new TypeError("Runtime execution limits are invalid");
    }
    if (options.assembly.manifest.runtimePolicyId !== options.policies.runtimePolicyId) {
      throw new TypeError("Runtime policy does not match Agent Manifest");
    }
    this.assembly = options.assembly;
    this.policies = options.policies;
    this.limits = options.limits;
    Object.freeze(this);
  }

  toSnapshot(): AgentRuntimeConfigurationSnapshot {
    return Object.freeze({
      schemaVersion: this.schemaVersion,
      conversationId: this.conversationId,
      assembly: this.assembly.toSnapshot(),
      policies: this.policies.toSnapshot(),
      limits: this.limits.toSnapshot(),
    });
  }
}

function isAgentAssembly(value: unknown): value is AgentAssembly {
  return value !== null &&
    typeof value === "object" &&
    "manifest" in value &&
    "toolView" in value &&
    typeof (value as { toSnapshot?: unknown }).toSnapshot === "function";
}

function captureIdentity(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function capturePositiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as number;
}
