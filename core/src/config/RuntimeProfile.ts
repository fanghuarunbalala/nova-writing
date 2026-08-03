/** Complete immutable Runtime, Context, Tool, Sandbox, Subagent, and Todo profiles. */
import {
  captureBoolean,
  captureIdentity,
  captureInteger,
  captureNonBlank,
  captureNumber,
  captureStringList,
  freezeSnapshot,
} from "./ConfigurationValues.js";

export type RuntimePreset = "economy" | "balanced" | "autonomous" | "custom";
export type ContextPreset = "economy" | "balanced" | "long_context" | "custom";
export type ApprovalMode =
  | "safe_automatic"
  | "ask_on_write"
  | "ask_on_risk"
  | "always_ask";
export type SandboxMode = "strict" | "workspace" | "host";
export type ProcessIsolationMode = "auto" | "in_process" | "child_process";
export type SubagentRetentionPolicy = "discard" | "session" | "durable";

export interface TurnPolicySettingsSnapshot {
  readonly maximumTurns: number;
  readonly maximumProviderCallsPerTurn: number;
  readonly maximumToolCallsPerTurn: number;
  readonly maximumConsecutiveErrors: number;
  readonly providerCallTimeoutMs: number;
  readonly toolExecutionTimeoutMs: number;
  readonly conversationIdleTimeoutMs: number;
  readonly stopGracePeriodMs: number;
  readonly providerRetryMaximumAttempts: number;
  readonly providerRetryInitialBackoffMs: number;
  readonly providerRetryMaximumBackoffMs: number;
  readonly retryRateLimits: boolean;
  readonly retryServerErrors: boolean;
  readonly fallbackOnProviderFailure: boolean;
}

export class TurnPolicySettings {
  readonly maximumTurns: number;
  readonly maximumProviderCallsPerTurn: number;
  readonly maximumToolCallsPerTurn: number;
  readonly maximumConsecutiveErrors: number;
  readonly providerCallTimeoutMs: number;
  readonly toolExecutionTimeoutMs: number;
  readonly conversationIdleTimeoutMs: number;
  readonly stopGracePeriodMs: number;
  readonly providerRetryMaximumAttempts: number;
  readonly providerRetryInitialBackoffMs: number;
  readonly providerRetryMaximumBackoffMs: number;
  readonly retryRateLimits: boolean;
  readonly retryServerErrors: boolean;
  readonly fallbackOnProviderFailure: boolean;

  constructor(options: TurnPolicySettingsSnapshot) {
    this.maximumTurns = captureInteger(options.maximumTurns, "Maximum Turns", 1, 10_000);
    this.maximumProviderCallsPerTurn = captureInteger(
      options.maximumProviderCallsPerTurn,
      "Maximum Provider calls per Turn",
      1,
      1_000,
    );
    this.maximumToolCallsPerTurn = captureInteger(
      options.maximumToolCallsPerTurn,
      "Maximum Tool calls per Turn",
      1,
      10_000,
    );
    this.maximumConsecutiveErrors = captureInteger(
      options.maximumConsecutiveErrors,
      "Maximum consecutive errors",
      1,
      1_000,
    );
    this.providerCallTimeoutMs = captureInteger(
      options.providerCallTimeoutMs,
      "Provider call timeout",
      100,
      3_600_000,
    );
    this.toolExecutionTimeoutMs = captureInteger(
      options.toolExecutionTimeoutMs,
      "Tool execution timeout",
      100,
      86_400_000,
    );
    this.conversationIdleTimeoutMs = captureInteger(
      options.conversationIdleTimeoutMs,
      "Conversation idle timeout",
      1_000,
      604_800_000,
    );
    this.stopGracePeriodMs = captureInteger(
      options.stopGracePeriodMs,
      "Stop grace period",
      0,
      300_000,
    );
    this.providerRetryMaximumAttempts = captureInteger(
      options.providerRetryMaximumAttempts,
      "Provider retry maximum attempts",
      1,
      32,
    );
    this.providerRetryInitialBackoffMs = captureInteger(
      options.providerRetryInitialBackoffMs,
      "Provider retry initial backoff",
      0,
      600_000,
    );
    this.providerRetryMaximumBackoffMs = captureInteger(
      options.providerRetryMaximumBackoffMs,
      "Provider retry maximum backoff",
      0,
      3_600_000,
    );
    this.retryRateLimits = captureBoolean(options.retryRateLimits, "Retry rate limits");
    this.retryServerErrors = captureBoolean(
      options.retryServerErrors,
      "Retry Server errors",
    );
    this.fallbackOnProviderFailure = captureBoolean(
      options.fallbackOnProviderFailure,
      "Fallback on Provider failure",
    );
    if (this.providerRetryMaximumBackoffMs < this.providerRetryInitialBackoffMs) {
      throw new TypeError("Provider retry maximum backoff is too small");
    }
    Object.freeze(this);
  }

  toSnapshot(): TurnPolicySettingsSnapshot {
    return freezeSnapshot({
      maximumTurns: this.maximumTurns,
      maximumProviderCallsPerTurn: this.maximumProviderCallsPerTurn,
      maximumToolCallsPerTurn: this.maximumToolCallsPerTurn,
      maximumConsecutiveErrors: this.maximumConsecutiveErrors,
      providerCallTimeoutMs: this.providerCallTimeoutMs,
      toolExecutionTimeoutMs: this.toolExecutionTimeoutMs,
      conversationIdleTimeoutMs: this.conversationIdleTimeoutMs,
      stopGracePeriodMs: this.stopGracePeriodMs,
      providerRetryMaximumAttempts: this.providerRetryMaximumAttempts,
      providerRetryInitialBackoffMs: this.providerRetryInitialBackoffMs,
      providerRetryMaximumBackoffMs: this.providerRetryMaximumBackoffMs,
      retryRateLimits: this.retryRateLimits,
      retryServerErrors: this.retryServerErrors,
      fallbackOnProviderFailure: this.fallbackOnProviderFailure,
    });
  }
}

export interface ContextPolicySettingsSnapshot {
  readonly preset: ContextPreset;
  readonly maximumContextTokens: number;
  readonly providerReserveTokens: number;
  readonly compactionTriggerRatio: number;
  readonly compactionTargetRatio: number;
  readonly recentWindowTokens: number;
  readonly maximumCheckpointTokens: number;
  readonly maximumPinnedTokens: number;
  readonly oversizedContentThresholdBytes: number;
  readonly oversizedContentRetentionDays: number;
  readonly preserveRecentToolResults: boolean;
  readonly preserveIncompleteTodos: boolean;
  readonly preserveRecentUserConstraints: boolean;
  readonly modelAssistedCompaction: boolean;
  readonly compactionMaximumAttempts: number;
  readonly compactionTimeoutMs: number;
}

export class ContextPolicySettings {
  readonly preset: ContextPreset;
  readonly maximumContextTokens: number;
  readonly providerReserveTokens: number;
  readonly compactionTriggerRatio: number;
  readonly compactionTargetRatio: number;
  readonly recentWindowTokens: number;
  readonly maximumCheckpointTokens: number;
  readonly maximumPinnedTokens: number;
  readonly oversizedContentThresholdBytes: number;
  readonly oversizedContentRetentionDays: number;
  readonly preserveRecentToolResults: boolean;
  readonly preserveIncompleteTodos: boolean;
  readonly preserveRecentUserConstraints: boolean;
  readonly modelAssistedCompaction: boolean;
  readonly compactionMaximumAttempts: number;
  readonly compactionTimeoutMs: number;

  constructor(options: ContextPolicySettingsSnapshot) {
    this.preset = captureContextPreset(options.preset);
    this.maximumContextTokens = captureInteger(
      options.maximumContextTokens,
      "Maximum Context tokens",
      1_024,
      100_000_000,
    );
    this.providerReserveTokens = captureInteger(
      options.providerReserveTokens,
      "Provider reserve tokens",
      0,
      this.maximumContextTokens - 1,
    );
    this.compactionTriggerRatio = captureNumber(
      options.compactionTriggerRatio,
      "Compaction trigger ratio",
      0.1,
      1,
    );
    this.compactionTargetRatio = captureNumber(
      options.compactionTargetRatio,
      "Compaction target ratio",
      0.05,
      0.95,
    );
    this.recentWindowTokens = captureInteger(
      options.recentWindowTokens,
      "Recent Context window",
      0,
      this.maximumContextTokens,
    );
    this.maximumCheckpointTokens = captureInteger(
      options.maximumCheckpointTokens,
      "Maximum Checkpoint tokens",
      0,
      this.maximumContextTokens,
    );
    this.maximumPinnedTokens = captureInteger(
      options.maximumPinnedTokens,
      "Maximum pinned tokens",
      0,
      this.maximumContextTokens,
    );
    this.oversizedContentThresholdBytes = captureInteger(
      options.oversizedContentThresholdBytes,
      "Oversized content threshold",
      1_024,
      Number.MAX_SAFE_INTEGER,
    );
    this.oversizedContentRetentionDays = captureInteger(
      options.oversizedContentRetentionDays,
      "Oversized content retention",
      1,
      3_650,
    );
    this.preserveRecentToolResults = captureBoolean(
      options.preserveRecentToolResults,
      "Preserve Tool results",
    );
    this.preserveIncompleteTodos = captureBoolean(
      options.preserveIncompleteTodos,
      "Preserve incomplete Todos",
    );
    this.preserveRecentUserConstraints = captureBoolean(
      options.preserveRecentUserConstraints,
      "Preserve user constraints",
    );
    this.modelAssistedCompaction = captureBoolean(
      options.modelAssistedCompaction,
      "Model-assisted compaction",
    );
    this.compactionMaximumAttempts = captureInteger(
      options.compactionMaximumAttempts,
      "Compaction maximum attempts",
      1,
      32,
    );
    this.compactionTimeoutMs = captureInteger(
      options.compactionTimeoutMs,
      "Compaction timeout",
      100,
      3_600_000,
    );
    if (this.compactionTargetRatio >= this.compactionTriggerRatio) {
      throw new TypeError("Compaction target must be below the trigger");
    }
    Object.freeze(this);
  }

  toSnapshot(): ContextPolicySettingsSnapshot {
    return freezeSnapshot({
      preset: this.preset,
      maximumContextTokens: this.maximumContextTokens,
      providerReserveTokens: this.providerReserveTokens,
      compactionTriggerRatio: this.compactionTriggerRatio,
      compactionTargetRatio: this.compactionTargetRatio,
      recentWindowTokens: this.recentWindowTokens,
      maximumCheckpointTokens: this.maximumCheckpointTokens,
      maximumPinnedTokens: this.maximumPinnedTokens,
      oversizedContentThresholdBytes: this.oversizedContentThresholdBytes,
      oversizedContentRetentionDays: this.oversizedContentRetentionDays,
      preserveRecentToolResults: this.preserveRecentToolResults,
      preserveIncompleteTodos: this.preserveIncompleteTodos,
      preserveRecentUserConstraints: this.preserveRecentUserConstraints,
      modelAssistedCompaction: this.modelAssistedCompaction,
      compactionMaximumAttempts: this.compactionMaximumAttempts,
      compactionTimeoutMs: this.compactionTimeoutMs,
    });
  }
}

export interface NudgePolicySettingsSnapshot {
  readonly enabled: boolean;
  readonly maximumPerProviderCall: number;
  readonly maximumTurnsReminderEnabled: boolean;
  readonly toolIdleReminderEnabled: boolean;
  readonly todoIdleReminderEnabled: boolean;
  readonly contextPressureReminderEnabled: boolean;
  readonly completionReminderEnabled: boolean;
  readonly approvalWaitingReminderEnabled: boolean;
  readonly subagentWaitingReminderEnabled: boolean;
  readonly cooldownTurns: number;
  readonly suppressDuplicates: boolean;
}

export class NudgePolicySettings {
  readonly enabled: boolean;
  readonly maximumPerProviderCall: number;
  readonly maximumTurnsReminderEnabled: boolean;
  readonly toolIdleReminderEnabled: boolean;
  readonly todoIdleReminderEnabled: boolean;
  readonly contextPressureReminderEnabled: boolean;
  readonly completionReminderEnabled: boolean;
  readonly approvalWaitingReminderEnabled: boolean;
  readonly subagentWaitingReminderEnabled: boolean;
  readonly cooldownTurns: number;
  readonly suppressDuplicates: boolean;

  constructor(options: NudgePolicySettingsSnapshot) {
    this.enabled = captureBoolean(options.enabled, "Nudge enabled");
    this.maximumPerProviderCall = captureInteger(
      options.maximumPerProviderCall,
      "Maximum Nudges per Provider call",
      0,
      32,
    );
    this.maximumTurnsReminderEnabled = captureBoolean(
      options.maximumTurnsReminderEnabled,
      "Maximum Turns reminder",
    );
    this.toolIdleReminderEnabled = captureBoolean(
      options.toolIdleReminderEnabled,
      "Tool idle reminder",
    );
    this.todoIdleReminderEnabled = captureBoolean(
      options.todoIdleReminderEnabled,
      "Todo idle reminder",
    );
    this.contextPressureReminderEnabled = captureBoolean(
      options.contextPressureReminderEnabled,
      "Context pressure reminder",
    );
    this.completionReminderEnabled = captureBoolean(
      options.completionReminderEnabled,
      "Completion reminder",
    );
    this.approvalWaitingReminderEnabled = captureBoolean(
      options.approvalWaitingReminderEnabled,
      "Approval waiting reminder",
    );
    this.subagentWaitingReminderEnabled = captureBoolean(
      options.subagentWaitingReminderEnabled,
      "Subagent waiting reminder",
    );
    this.cooldownTurns = captureInteger(options.cooldownTurns, "Nudge cooldown", 0, 1_000);
    this.suppressDuplicates = captureBoolean(
      options.suppressDuplicates,
      "Suppress duplicate Nudges",
    );
    Object.freeze(this);
  }

  toSnapshot(): NudgePolicySettingsSnapshot {
    return freezeSnapshot({
      enabled: this.enabled,
      maximumPerProviderCall: this.maximumPerProviderCall,
      maximumTurnsReminderEnabled: this.maximumTurnsReminderEnabled,
      toolIdleReminderEnabled: this.toolIdleReminderEnabled,
      todoIdleReminderEnabled: this.todoIdleReminderEnabled,
      contextPressureReminderEnabled: this.contextPressureReminderEnabled,
      completionReminderEnabled: this.completionReminderEnabled,
      approvalWaitingReminderEnabled: this.approvalWaitingReminderEnabled,
      subagentWaitingReminderEnabled: this.subagentWaitingReminderEnabled,
      cooldownTurns: this.cooldownTurns,
      suppressDuplicates: this.suppressDuplicates,
    });
  }
}

export interface FilesystemPermissionSettingsSnapshot {
  readonly workspaceRead: boolean;
  readonly workspaceWrite: boolean;
  readonly outsideWorkspaceRead: boolean;
  readonly outsideWorkspaceWrite: boolean;
  readonly deleteAllowed: boolean;
  readonly overwriteAllowed: boolean;
  readonly followSymbolicLinks: boolean;
  readonly additionalAllowedRoots: readonly string[];
  readonly deniedRoots: readonly string[];
  readonly maximumReadBytes: number;
  readonly maximumWriteBytes: number;
}

export class FilesystemPermissionSettings {
  readonly workspaceRead: boolean;
  readonly workspaceWrite: boolean;
  readonly outsideWorkspaceRead: boolean;
  readonly outsideWorkspaceWrite: boolean;
  readonly deleteAllowed: boolean;
  readonly overwriteAllowed: boolean;
  readonly followSymbolicLinks: boolean;
  readonly additionalAllowedRoots: readonly string[];
  readonly deniedRoots: readonly string[];
  readonly maximumReadBytes: number;
  readonly maximumWriteBytes: number;

  constructor(options: FilesystemPermissionSettingsSnapshot) {
    this.workspaceRead = captureBoolean(options.workspaceRead, "Workspace read");
    this.workspaceWrite = captureBoolean(options.workspaceWrite, "Workspace write");
    this.outsideWorkspaceRead = captureBoolean(
      options.outsideWorkspaceRead,
      "Outside Workspace read",
    );
    this.outsideWorkspaceWrite = captureBoolean(
      options.outsideWorkspaceWrite,
      "Outside Workspace write",
    );
    this.deleteAllowed = captureBoolean(options.deleteAllowed, "Delete allowed");
    this.overwriteAllowed = captureBoolean(options.overwriteAllowed, "Overwrite allowed");
    this.followSymbolicLinks = captureBoolean(
      options.followSymbolicLinks,
      "Follow symbolic links",
    );
    this.additionalAllowedRoots = captureStringList(
      options.additionalAllowedRoots,
      "Additional allowed root",
    );
    this.deniedRoots = captureStringList(options.deniedRoots, "Denied root");
    this.maximumReadBytes = captureInteger(
      options.maximumReadBytes,
      "Maximum filesystem read",
      1,
      Number.MAX_SAFE_INTEGER,
    );
    this.maximumWriteBytes = captureInteger(
      options.maximumWriteBytes,
      "Maximum filesystem write",
      1,
      Number.MAX_SAFE_INTEGER,
    );
    Object.freeze(this);
  }

  toSnapshot(): FilesystemPermissionSettingsSnapshot {
    return freezeSnapshot({
      workspaceRead: this.workspaceRead,
      workspaceWrite: this.workspaceWrite,
      outsideWorkspaceRead: this.outsideWorkspaceRead,
      outsideWorkspaceWrite: this.outsideWorkspaceWrite,
      deleteAllowed: this.deleteAllowed,
      overwriteAllowed: this.overwriteAllowed,
      followSymbolicLinks: this.followSymbolicLinks,
      additionalAllowedRoots: this.additionalAllowedRoots,
      deniedRoots: this.deniedRoots,
      maximumReadBytes: this.maximumReadBytes,
      maximumWriteBytes: this.maximumWriteBytes,
    });
  }
}

export interface ProcessPermissionSettingsSnapshot {
  readonly enabled: boolean;
  readonly allowedCommands: readonly string[];
  readonly deniedCommands: readonly string[];
  readonly allowedEnvironmentVariables: readonly string[];
  readonly interactiveProcesses: boolean;
  readonly backgroundProcesses: boolean;
  readonly maximumConcurrentProcesses: number;
  readonly maximumExecutionMs: number;
  readonly maximumOutputBytes: number;
}

export class ProcessPermissionSettings {
  readonly enabled: boolean;
  readonly allowedCommands: readonly string[];
  readonly deniedCommands: readonly string[];
  readonly allowedEnvironmentVariables: readonly string[];
  readonly interactiveProcesses: boolean;
  readonly backgroundProcesses: boolean;
  readonly maximumConcurrentProcesses: number;
  readonly maximumExecutionMs: number;
  readonly maximumOutputBytes: number;

  constructor(options: ProcessPermissionSettingsSnapshot) {
    this.enabled = captureBoolean(options.enabled, "Process execution");
    this.allowedCommands = captureStringList(options.allowedCommands, "Allowed command");
    this.deniedCommands = captureStringList(options.deniedCommands, "Denied command");
    this.allowedEnvironmentVariables = captureStringList(
      options.allowedEnvironmentVariables,
      "Allowed environment variable",
    );
    this.interactiveProcesses = captureBoolean(
      options.interactiveProcesses,
      "Interactive processes",
    );
    this.backgroundProcesses = captureBoolean(
      options.backgroundProcesses,
      "Background processes",
    );
    this.maximumConcurrentProcesses = captureInteger(
      options.maximumConcurrentProcesses,
      "Maximum concurrent processes",
      1,
      1_024,
    );
    this.maximumExecutionMs = captureInteger(
      options.maximumExecutionMs,
      "Maximum process execution",
      100,
      604_800_000,
    );
    this.maximumOutputBytes = captureInteger(
      options.maximumOutputBytes,
      "Maximum process output",
      1,
      Number.MAX_SAFE_INTEGER,
    );
    Object.freeze(this);
  }

  toSnapshot(): ProcessPermissionSettingsSnapshot {
    return freezeSnapshot({
      enabled: this.enabled,
      allowedCommands: this.allowedCommands,
      deniedCommands: this.deniedCommands,
      allowedEnvironmentVariables: this.allowedEnvironmentVariables,
      interactiveProcesses: this.interactiveProcesses,
      backgroundProcesses: this.backgroundProcesses,
      maximumConcurrentProcesses: this.maximumConcurrentProcesses,
      maximumExecutionMs: this.maximumExecutionMs,
      maximumOutputBytes: this.maximumOutputBytes,
    });
  }
}

export interface ToolNetworkPermissionSettingsSnapshot {
  readonly enabled: boolean;
  readonly allowedHosts: readonly string[];
  readonly deniedHosts: readonly string[];
  readonly localNetworkAllowed: boolean;
  readonly loopbackAllowed: boolean;
  readonly insecureHttpAllowed: boolean;
  readonly maximumDownloadBytes: number;
  readonly maximumConcurrentRequests: number;
  readonly requestTimeoutMs: number;
}

export class ToolNetworkPermissionSettings {
  readonly enabled: boolean;
  readonly allowedHosts: readonly string[];
  readonly deniedHosts: readonly string[];
  readonly localNetworkAllowed: boolean;
  readonly loopbackAllowed: boolean;
  readonly insecureHttpAllowed: boolean;
  readonly maximumDownloadBytes: number;
  readonly maximumConcurrentRequests: number;
  readonly requestTimeoutMs: number;

  constructor(options: ToolNetworkPermissionSettingsSnapshot) {
    this.enabled = captureBoolean(options.enabled, "Tool network");
    this.allowedHosts = captureStringList(options.allowedHosts, "Allowed network host");
    this.deniedHosts = captureStringList(options.deniedHosts, "Denied network host");
    this.localNetworkAllowed = captureBoolean(
      options.localNetworkAllowed,
      "Local network allowed",
    );
    this.loopbackAllowed = captureBoolean(options.loopbackAllowed, "Loopback allowed");
    this.insecureHttpAllowed = captureBoolean(
      options.insecureHttpAllowed,
      "Insecure HTTP allowed",
    );
    this.maximumDownloadBytes = captureInteger(
      options.maximumDownloadBytes,
      "Maximum download",
      1,
      Number.MAX_SAFE_INTEGER,
    );
    this.maximumConcurrentRequests = captureInteger(
      options.maximumConcurrentRequests,
      "Maximum Tool network requests",
      1,
      1_024,
    );
    this.requestTimeoutMs = captureInteger(
      options.requestTimeoutMs,
      "Tool network timeout",
      100,
      3_600_000,
    );
    Object.freeze(this);
  }

  toSnapshot(): ToolNetworkPermissionSettingsSnapshot {
    return freezeSnapshot({
      enabled: this.enabled,
      allowedHosts: this.allowedHosts,
      deniedHosts: this.deniedHosts,
      localNetworkAllowed: this.localNetworkAllowed,
      loopbackAllowed: this.loopbackAllowed,
      insecureHttpAllowed: this.insecureHttpAllowed,
      maximumDownloadBytes: this.maximumDownloadBytes,
      maximumConcurrentRequests: this.maximumConcurrentRequests,
      requestTimeoutMs: this.requestTimeoutMs,
    });
  }
}

export interface SandboxSettingsSnapshot {
  readonly mode: SandboxMode;
  readonly processIsolation: ProcessIsolationMode;
  readonly networkIsolation: boolean;
  readonly cleanupTemporaryFiles: boolean;
  readonly maximumTemporaryBytes: number;
  readonly maximumMemoryBytes: number;
  readonly maximumCpuTimeMs: number;
}

export class SandboxSettings {
  readonly mode: SandboxMode;
  readonly processIsolation: ProcessIsolationMode;
  readonly networkIsolation: boolean;
  readonly cleanupTemporaryFiles: boolean;
  readonly maximumTemporaryBytes: number;
  readonly maximumMemoryBytes: number;
  readonly maximumCpuTimeMs: number;

  constructor(options: SandboxSettingsSnapshot) {
    this.mode = captureSandboxMode(options.mode);
    this.processIsolation = captureProcessIsolation(options.processIsolation);
    this.networkIsolation = captureBoolean(options.networkIsolation, "Network isolation");
    this.cleanupTemporaryFiles = captureBoolean(
      options.cleanupTemporaryFiles,
      "Temporary cleanup",
    );
    this.maximumTemporaryBytes = captureInteger(
      options.maximumTemporaryBytes,
      "Maximum temporary storage",
      1_048_576,
      Number.MAX_SAFE_INTEGER,
    );
    this.maximumMemoryBytes = captureInteger(
      options.maximumMemoryBytes,
      "Maximum Sandbox memory",
      16_777_216,
      Number.MAX_SAFE_INTEGER,
    );
    this.maximumCpuTimeMs = captureInteger(
      options.maximumCpuTimeMs,
      "Maximum Sandbox CPU time",
      100,
      604_800_000,
    );
    Object.freeze(this);
  }

  toSnapshot(): SandboxSettingsSnapshot {
    return freezeSnapshot({
      mode: this.mode,
      processIsolation: this.processIsolation,
      networkIsolation: this.networkIsolation,
      cleanupTemporaryFiles: this.cleanupTemporaryFiles,
      maximumTemporaryBytes: this.maximumTemporaryBytes,
      maximumMemoryBytes: this.maximumMemoryBytes,
      maximumCpuTimeMs: this.maximumCpuTimeMs,
    });
  }
}

export interface ToolPermissionProfileSnapshot {
  readonly id: string;
  readonly displayName: string;
  readonly approvalMode: ApprovalMode;
  readonly approvalTimeoutMs: number;
  readonly rememberConversationDecisions: boolean;
  readonly filesystem: FilesystemPermissionSettingsSnapshot;
  readonly process: ProcessPermissionSettingsSnapshot;
  readonly network: ToolNetworkPermissionSettingsSnapshot;
  readonly sandbox: SandboxSettingsSnapshot;
}

export class ToolPermissionProfile {
  readonly id: string;
  readonly displayName: string;
  readonly approvalMode: ApprovalMode;
  readonly approvalTimeoutMs: number;
  readonly rememberConversationDecisions: boolean;
  readonly filesystem: FilesystemPermissionSettings;
  readonly process: ProcessPermissionSettings;
  readonly network: ToolNetworkPermissionSettings;
  readonly sandbox: SandboxSettings;

  constructor(options: ToolPermissionProfileSnapshot) {
    this.id = captureIdentity(options.id, "Tool Permission Profile ID");
    this.displayName = captureNonBlank(
      options.displayName,
      "Tool Permission Profile name",
      256,
    );
    this.approvalMode = captureApprovalMode(options.approvalMode);
    this.approvalTimeoutMs = captureInteger(
      options.approvalTimeoutMs,
      "Approval timeout",
      1_000,
      604_800_000,
    );
    this.rememberConversationDecisions = captureBoolean(
      options.rememberConversationDecisions,
      "Remember Conversation Approval decisions",
    );
    this.filesystem = new FilesystemPermissionSettings(options.filesystem);
    this.process = new ProcessPermissionSettings(options.process);
    this.network = new ToolNetworkPermissionSettings(options.network);
    this.sandbox = new SandboxSettings(options.sandbox);
    Object.freeze(this);
  }

  toSnapshot(): ToolPermissionProfileSnapshot {
    return freezeSnapshot({
      id: this.id,
      displayName: this.displayName,
      approvalMode: this.approvalMode,
      approvalTimeoutMs: this.approvalTimeoutMs,
      rememberConversationDecisions: this.rememberConversationDecisions,
      filesystem: this.filesystem.toSnapshot(),
      process: this.process.toSnapshot(),
      network: this.network.toSnapshot(),
      sandbox: this.sandbox.toSnapshot(),
    });
  }
}

export interface SubagentSettingsSnapshot {
  readonly enabled: boolean;
  readonly maximumConcurrency: number;
  readonly maximumDepth: number;
  readonly maximumTotalChildren: number;
  readonly maximumChildrenPerTurn: number;
  readonly defaultTimeoutMs: number;
  readonly retentionPolicy: SubagentRetentionPolicy;
  readonly retentionDays: number;
  readonly inheritModelProfile: boolean;
  readonly allowModelOverride: boolean;
  readonly inheritToolPermissions: boolean;
  readonly maximumOutputBytes: number;
  readonly cascadeCancellation: boolean;
  readonly retryFailures: boolean;
}

export class SubagentSettings {
  readonly enabled: boolean;
  readonly maximumConcurrency: number;
  readonly maximumDepth: number;
  readonly maximumTotalChildren: number;
  readonly maximumChildrenPerTurn: number;
  readonly defaultTimeoutMs: number;
  readonly retentionPolicy: SubagentRetentionPolicy;
  readonly retentionDays: number;
  readonly inheritModelProfile: boolean;
  readonly allowModelOverride: boolean;
  readonly inheritToolPermissions: boolean;
  readonly maximumOutputBytes: number;
  readonly cascadeCancellation: boolean;
  readonly retryFailures: boolean;

  constructor(options: SubagentSettingsSnapshot) {
    this.enabled = captureBoolean(options.enabled, "Subagent enabled");
    this.maximumConcurrency = captureInteger(
      options.maximumConcurrency,
      "Maximum Subagent concurrency",
      1,
      1_024,
    );
    this.maximumDepth = captureInteger(options.maximumDepth, "Maximum Subagent depth", 1, 64);
    this.maximumTotalChildren = captureInteger(
      options.maximumTotalChildren,
      "Maximum Subagent children",
      1,
      100_000,
    );
    this.maximumChildrenPerTurn = captureInteger(
      options.maximumChildrenPerTurn,
      "Maximum Subagents per Turn",
      1,
      1_000,
    );
    this.defaultTimeoutMs = captureInteger(
      options.defaultTimeoutMs,
      "Subagent timeout",
      100,
      604_800_000,
    );
    this.retentionPolicy = captureSubagentRetention(options.retentionPolicy);
    this.retentionDays = captureInteger(
      options.retentionDays,
      "Subagent retention",
      0,
      3_650,
    );
    this.inheritModelProfile = captureBoolean(
      options.inheritModelProfile,
      "Inherit Model Profile",
    );
    this.allowModelOverride = captureBoolean(
      options.allowModelOverride,
      "Allow Subagent Model override",
    );
    this.inheritToolPermissions = captureBoolean(
      options.inheritToolPermissions,
      "Inherit Tool permissions",
    );
    this.maximumOutputBytes = captureInteger(
      options.maximumOutputBytes,
      "Maximum Subagent output",
      1,
      Number.MAX_SAFE_INTEGER,
    );
    this.cascadeCancellation = captureBoolean(
      options.cascadeCancellation,
      "Cascade Subagent cancellation",
    );
    this.retryFailures = captureBoolean(options.retryFailures, "Retry Subagent failures");
    Object.freeze(this);
  }

  toSnapshot(): SubagentSettingsSnapshot {
    return freezeSnapshot({
      enabled: this.enabled,
      maximumConcurrency: this.maximumConcurrency,
      maximumDepth: this.maximumDepth,
      maximumTotalChildren: this.maximumTotalChildren,
      maximumChildrenPerTurn: this.maximumChildrenPerTurn,
      defaultTimeoutMs: this.defaultTimeoutMs,
      retentionPolicy: this.retentionPolicy,
      retentionDays: this.retentionDays,
      inheritModelProfile: this.inheritModelProfile,
      allowModelOverride: this.allowModelOverride,
      inheritToolPermissions: this.inheritToolPermissions,
      maximumOutputBytes: this.maximumOutputBytes,
      cascadeCancellation: this.cascadeCancellation,
      retryFailures: this.retryFailures,
    });
  }
}

export interface TodoSettingsSnapshot {
  readonly automaticPlanningEnabled: boolean;
  readonly suggestedMinimumSteps: number;
  readonly maximumTodos: number;
  readonly showCompletedTodos: boolean;
  readonly completedTodoRetentionCount: number;
  readonly injectAtTurnStart: boolean;
  readonly idleReminderEnabled: boolean;
}

export class TodoSettings {
  readonly automaticPlanningEnabled: boolean;
  readonly suggestedMinimumSteps: number;
  readonly maximumTodos: number;
  readonly showCompletedTodos: boolean;
  readonly completedTodoRetentionCount: number;
  readonly injectAtTurnStart: boolean;
  readonly idleReminderEnabled: boolean;

  constructor(options: TodoSettingsSnapshot) {
    this.automaticPlanningEnabled = captureBoolean(
      options.automaticPlanningEnabled,
      "Automatic planning",
    );
    this.suggestedMinimumSteps = captureInteger(
      options.suggestedMinimumSteps,
      "Suggested Todo minimum steps",
      1,
      100,
    );
    this.maximumTodos = captureInteger(options.maximumTodos, "Maximum Todos", 1, 10_000);
    this.showCompletedTodos = captureBoolean(
      options.showCompletedTodos,
      "Show completed Todos",
    );
    this.completedTodoRetentionCount = captureInteger(
      options.completedTodoRetentionCount,
      "Completed Todo retention",
      0,
      10_000,
    );
    this.injectAtTurnStart = captureBoolean(
      options.injectAtTurnStart,
      "Inject Todos at Turn start",
    );
    this.idleReminderEnabled = captureBoolean(
      options.idleReminderEnabled,
      "Todo idle reminder",
    );
    Object.freeze(this);
  }

  toSnapshot(): TodoSettingsSnapshot {
    return freezeSnapshot({
      automaticPlanningEnabled: this.automaticPlanningEnabled,
      suggestedMinimumSteps: this.suggestedMinimumSteps,
      maximumTodos: this.maximumTodos,
      showCompletedTodos: this.showCompletedTodos,
      completedTodoRetentionCount: this.completedTodoRetentionCount,
      injectAtTurnStart: this.injectAtTurnStart,
      idleReminderEnabled: this.idleReminderEnabled,
    });
  }
}

export interface RuntimeProfileSnapshot {
  readonly id: string;
  readonly displayName: string;
  readonly preset: RuntimePreset;
  readonly contextPolicyId: string;
  readonly nudgePolicyId: string;
  readonly turns: TurnPolicySettingsSnapshot;
  readonly context: ContextPolicySettingsSnapshot;
  readonly nudge: NudgePolicySettingsSnapshot;
  readonly subagents: SubagentSettingsSnapshot;
  readonly todos: TodoSettingsSnapshot;
}

export class RuntimeProfile {
  readonly id: string;
  readonly displayName: string;
  readonly preset: RuntimePreset;
  readonly contextPolicyId: string;
  readonly nudgePolicyId: string;
  readonly turns: TurnPolicySettings;
  readonly context: ContextPolicySettings;
  readonly nudge: NudgePolicySettings;
  readonly subagents: SubagentSettings;
  readonly todos: TodoSettings;

  constructor(options: RuntimeProfileSnapshot) {
    this.id = captureIdentity(options.id, "Runtime Profile ID");
    this.displayName = captureNonBlank(options.displayName, "Runtime Profile name", 256);
    this.preset = captureRuntimePreset(options.preset);
    this.contextPolicyId = captureIdentity(options.contextPolicyId, "Context policy ID");
    this.nudgePolicyId = captureIdentity(options.nudgePolicyId, "Nudge policy ID");
    this.turns = new TurnPolicySettings(options.turns);
    this.context = new ContextPolicySettings(options.context);
    this.nudge = new NudgePolicySettings(options.nudge);
    this.subagents = new SubagentSettings(options.subagents);
    this.todos = new TodoSettings(options.todos);
    Object.freeze(this);
  }

  toSnapshot(): RuntimeProfileSnapshot {
    return freezeSnapshot({
      id: this.id,
      displayName: this.displayName,
      preset: this.preset,
      contextPolicyId: this.contextPolicyId,
      nudgePolicyId: this.nudgePolicyId,
      turns: this.turns.toSnapshot(),
      context: this.context.toSnapshot(),
      nudge: this.nudge.toSnapshot(),
      subagents: this.subagents.toSnapshot(),
      todos: this.todos.toSnapshot(),
    });
  }
}

function captureRuntimePreset(value: unknown): RuntimePreset {
  if (
    value !== "economy" &&
    value !== "balanced" &&
    value !== "autonomous" &&
    value !== "custom"
  ) {
    throw new TypeError("Runtime preset is invalid");
  }
  return value;
}

function captureContextPreset(value: unknown): ContextPreset {
  if (
    value !== "economy" &&
    value !== "balanced" &&
    value !== "long_context" &&
    value !== "custom"
  ) {
    throw new TypeError("Context preset is invalid");
  }
  return value;
}

function captureApprovalMode(value: unknown): ApprovalMode {
  if (
    value !== "safe_automatic" &&
    value !== "ask_on_write" &&
    value !== "ask_on_risk" &&
    value !== "always_ask"
  ) {
    throw new TypeError("Approval mode is invalid");
  }
  return value;
}

function captureSandboxMode(value: unknown): SandboxMode {
  if (value !== "strict" && value !== "workspace" && value !== "host") {
    throw new TypeError("Sandbox mode is invalid");
  }
  return value;
}

function captureProcessIsolation(value: unknown): ProcessIsolationMode {
  if (value !== "auto" && value !== "in_process" && value !== "child_process") {
    throw new TypeError("Process isolation mode is invalid");
  }
  return value;
}

function captureSubagentRetention(value: unknown): SubagentRetentionPolicy {
  if (value !== "discard" && value !== "session" && value !== "durable") {
    throw new TypeError("Subagent retention policy is invalid");
  }
  return value;
}
