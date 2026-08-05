/** Immutable user-facing application, client, storage, privacy, and network settings. */
import {
  captureBoolean,
  captureInteger,
  captureNonBlank,
  captureOptionalNonBlank,
  captureScalarRecord,
  captureStringList,
  freezeSnapshot,
  type JsonScalar,
} from "./ConfigurationValues.js";

export type StartupBehavior = "welcome" | "reopen_last_workspace";
export type ThemePreference = "system" | "light" | "dark";
export type InterfaceDensity = "comfortable" | "compact";
export type SidebarPreference = "expanded" | "collapsed";
export type CliOutputFormat = "text" | "json" | "jsonl";
export type CliColorMode = "auto" | "always" | "never";
export type ProxyMode = "system" | "disabled" | "custom";
export type AgentAutonomyLevel = "cautious" | "balanced" | "autonomous";
export type DiagnosticLogLevel =
  | "error"
  | "warn"
  | "info"
  | "debug"
  | "verbose";

export interface GeneralSettingsSnapshot {
  readonly locale: string;
  readonly startupBehavior: StartupBehavior;
  readonly reopenLastWorkspace: boolean;
  readonly confirmBeforeExit: boolean;
  readonly checkForUpdates: boolean;
  readonly autoUpdateEnabled: boolean;
  readonly defaultAgentType: string;
}

export class GeneralSettings {
  readonly locale: string;
  readonly startupBehavior: StartupBehavior;
  readonly reopenLastWorkspace: boolean;
  readonly confirmBeforeExit: boolean;
  readonly checkForUpdates: boolean;
  readonly autoUpdateEnabled: boolean;
  readonly defaultAgentType: string;

  constructor(options: GeneralSettingsSnapshot) {
    this.locale = captureNonBlank(options.locale, "Locale", 64);
    this.startupBehavior = captureStartupBehavior(options.startupBehavior);
    this.reopenLastWorkspace = captureBoolean(
      options.reopenLastWorkspace,
      "Reopen last Workspace",
    );
    this.confirmBeforeExit = captureBoolean(
      options.confirmBeforeExit,
      "Confirm before exit",
    );
    this.checkForUpdates = captureBoolean(options.checkForUpdates, "Check updates");
    this.autoUpdateEnabled = captureBoolean(
      options.autoUpdateEnabled,
      "Auto update",
    );
    this.defaultAgentType = captureNonBlank(
      options.defaultAgentType,
      "Default Agent type",
      64,
    );
    Object.freeze(this);
  }

  toSnapshot(): GeneralSettingsSnapshot {
    return freezeSnapshot({
      locale: this.locale,
      startupBehavior: this.startupBehavior,
      reopenLastWorkspace: this.reopenLastWorkspace,
      confirmBeforeExit: this.confirmBeforeExit,
      checkForUpdates: this.checkForUpdates,
      autoUpdateEnabled: this.autoUpdateEnabled,
      defaultAgentType: this.defaultAgentType,
    });
  }
}

export interface AgentPreferenceSettingsSnapshot {
  readonly responseLanguage: "auto" | string;
  readonly autonomyLevel: AgentAutonomyLevel;
  readonly useTodos: boolean;
  readonly useSubagents: boolean;
  readonly allowBackgroundTasks: boolean;
  readonly summarizeOnCompletion: boolean;
  readonly askBeforeCreativeDecisions: boolean;
  readonly showInternalState: boolean;
  readonly showPolicyEvents: boolean;
}

export class AgentPreferenceSettings {
  readonly responseLanguage: "auto" | string;
  readonly autonomyLevel: AgentAutonomyLevel;
  readonly useTodos: boolean;
  readonly useSubagents: boolean;
  readonly allowBackgroundTasks: boolean;
  readonly summarizeOnCompletion: boolean;
  readonly askBeforeCreativeDecisions: boolean;
  readonly showInternalState: boolean;
  readonly showPolicyEvents: boolean;

  constructor(options: AgentPreferenceSettingsSnapshot) {
    this.responseLanguage = captureNonBlank(
      options.responseLanguage,
      "Agent response language",
      64,
    );
    this.autonomyLevel = captureAutonomyLevel(options.autonomyLevel);
    this.useTodos = captureBoolean(options.useTodos, "Agent Todo use");
    this.useSubagents = captureBoolean(options.useSubagents, "Agent Subagent use");
    this.allowBackgroundTasks = captureBoolean(
      options.allowBackgroundTasks,
      "Agent background tasks",
    );
    this.summarizeOnCompletion = captureBoolean(
      options.summarizeOnCompletion,
      "Agent completion summary",
    );
    this.askBeforeCreativeDecisions = captureBoolean(
      options.askBeforeCreativeDecisions,
      "Creative decision confirmation",
    );
    this.showInternalState = captureBoolean(
      options.showInternalState,
      "Show Agent internal state",
    );
    this.showPolicyEvents = captureBoolean(
      options.showPolicyEvents,
      "Show Agent policy Events",
    );
    Object.freeze(this);
  }

  toSnapshot(): AgentPreferenceSettingsSnapshot {
    return freezeSnapshot({
      responseLanguage: this.responseLanguage,
      autonomyLevel: this.autonomyLevel,
      useTodos: this.useTodos,
      useSubagents: this.useSubagents,
      allowBackgroundTasks: this.allowBackgroundTasks,
      summarizeOnCompletion: this.summarizeOnCompletion,
      askBeforeCreativeDecisions: this.askBeforeCreativeDecisions,
      showInternalState: this.showInternalState,
      showPolicyEvents: this.showPolicyEvents,
    });
  }
}

export interface AppearanceSettingsSnapshot {
  readonly theme: ThemePreference;
  readonly interfaceScalePercent: number;
  readonly density: InterfaceDensity;
  readonly sidebar: SidebarPreference;
  readonly reduceMotion: boolean;
  readonly highContrast: boolean;
  readonly showEventTimestamps: boolean;
  readonly showToolTrace: boolean;
  readonly showPerformanceMetrics: boolean;
}

export class AppearanceSettings {
  readonly theme: ThemePreference;
  readonly interfaceScalePercent: number;
  readonly density: InterfaceDensity;
  readonly sidebar: SidebarPreference;
  readonly reduceMotion: boolean;
  readonly highContrast: boolean;
  readonly showEventTimestamps: boolean;
  readonly showToolTrace: boolean;
  readonly showPerformanceMetrics: boolean;

  constructor(options: AppearanceSettingsSnapshot) {
    this.theme = captureTheme(options.theme);
    this.interfaceScalePercent = captureInteger(
      options.interfaceScalePercent,
      "Interface scale",
      75,
      200,
    );
    this.density = captureDensity(options.density);
    this.sidebar = captureSidebar(options.sidebar);
    this.reduceMotion = captureBoolean(options.reduceMotion, "Reduce motion");
    this.highContrast = captureBoolean(options.highContrast, "High contrast");
    this.showEventTimestamps = captureBoolean(
      options.showEventTimestamps,
      "Show Event timestamps",
    );
    this.showToolTrace = captureBoolean(options.showToolTrace, "Show Tool trace");
    this.showPerformanceMetrics = captureBoolean(
      options.showPerformanceMetrics,
      "Show performance metrics",
    );
    Object.freeze(this);
  }

  toSnapshot(): AppearanceSettingsSnapshot {
    return freezeSnapshot({
      theme: this.theme,
      interfaceScalePercent: this.interfaceScalePercent,
      density: this.density,
      sidebar: this.sidebar,
      reduceMotion: this.reduceMotion,
      highContrast: this.highContrast,
      showEventTimestamps: this.showEventTimestamps,
      showToolTrace: this.showToolTrace,
      showPerformanceMetrics: this.showPerformanceMetrics,
    });
  }
}

export interface EditorSettingsSnapshot {
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly lineHeightPercent: number;
  readonly contentWidth: number;
  readonly spellcheck: boolean;
  readonly smartPunctuation: boolean;
  readonly showWordCount: boolean;
  readonly showBlockBoundaries: boolean;
  readonly autosaveEnabled: boolean;
  readonly autosaveDelayMs: number;
}

export class EditorSettings {
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly lineHeightPercent: number;
  readonly contentWidth: number;
  readonly spellcheck: boolean;
  readonly smartPunctuation: boolean;
  readonly showWordCount: boolean;
  readonly showBlockBoundaries: boolean;
  readonly autosaveEnabled: boolean;
  readonly autosaveDelayMs: number;

  constructor(options: EditorSettingsSnapshot) {
    this.fontFamily = captureNonBlank(options.fontFamily, "Editor font", 256);
    this.fontSize = captureInteger(options.fontSize, "Editor font size", 10, 72);
    this.lineHeightPercent = captureInteger(
      options.lineHeightPercent,
      "Editor line height",
      100,
      300,
    );
    this.contentWidth = captureInteger(
      options.contentWidth,
      "Editor content width",
      480,
      2_400,
    );
    this.spellcheck = captureBoolean(options.spellcheck, "Spellcheck");
    this.smartPunctuation = captureBoolean(
      options.smartPunctuation,
      "Smart punctuation",
    );
    this.showWordCount = captureBoolean(options.showWordCount, "Show word count");
    this.showBlockBoundaries = captureBoolean(
      options.showBlockBoundaries,
      "Show Block boundaries",
    );
    this.autosaveEnabled = captureBoolean(options.autosaveEnabled, "Autosave");
    this.autosaveDelayMs = captureInteger(
      options.autosaveDelayMs,
      "Autosave delay",
      100,
      60_000,
    );
    Object.freeze(this);
  }

  toSnapshot(): EditorSettingsSnapshot {
    return freezeSnapshot({
      fontFamily: this.fontFamily,
      fontSize: this.fontSize,
      lineHeightPercent: this.lineHeightPercent,
      contentWidth: this.contentWidth,
      spellcheck: this.spellcheck,
      smartPunctuation: this.smartPunctuation,
      showWordCount: this.showWordCount,
      showBlockBoundaries: this.showBlockBoundaries,
      autosaveEnabled: this.autosaveEnabled,
      autosaveDelayMs: this.autosaveDelayMs,
    });
  }
}

export interface StorageSettingsSnapshot {
  readonly storageRoot?: string;
  readonly cacheLimitBytes: number;
  readonly artifactLimitBytes: number;
  readonly logLimitBytes: number;
  readonly eventRetentionDays: number;
  readonly backupEnabled: boolean;
  readonly backupIntervalMinutes: number;
  readonly backupRetentionCount: number;
  readonly integrityCheckOnStartup: boolean;
}

export class StorageSettings {
  readonly storageRoot?: string;
  readonly cacheLimitBytes: number;
  readonly artifactLimitBytes: number;
  readonly logLimitBytes: number;
  readonly eventRetentionDays: number;
  readonly backupEnabled: boolean;
  readonly backupIntervalMinutes: number;
  readonly backupRetentionCount: number;
  readonly integrityCheckOnStartup: boolean;

  constructor(options: StorageSettingsSnapshot) {
    this.storageRoot = captureOptionalNonBlank(
      options.storageRoot,
      "Storage root",
      4_096,
    );
    this.cacheLimitBytes = captureInteger(
      options.cacheLimitBytes,
      "Cache limit",
      1_048_576,
      Number.MAX_SAFE_INTEGER,
    );
    this.artifactLimitBytes = captureInteger(
      options.artifactLimitBytes,
      "Artifact limit",
      1_048_576,
      Number.MAX_SAFE_INTEGER,
    );
    this.logLimitBytes = captureInteger(
      options.logLimitBytes,
      "Log limit",
      1_048_576,
      Number.MAX_SAFE_INTEGER,
    );
    this.eventRetentionDays = captureInteger(
      options.eventRetentionDays,
      "Event retention",
      1,
      3_650,
    );
    this.backupEnabled = captureBoolean(options.backupEnabled, "Backup enabled");
    this.backupIntervalMinutes = captureInteger(
      options.backupIntervalMinutes,
      "Backup interval",
      1,
      525_600,
    );
    this.backupRetentionCount = captureInteger(
      options.backupRetentionCount,
      "Backup retention",
      1,
      1_000,
    );
    this.integrityCheckOnStartup = captureBoolean(
      options.integrityCheckOnStartup,
      "Startup integrity check",
    );
    Object.freeze(this);
  }

  toSnapshot(): StorageSettingsSnapshot {
    return freezeSnapshot({
      ...(this.storageRoot === undefined ? {} : { storageRoot: this.storageRoot }),
      cacheLimitBytes: this.cacheLimitBytes,
      artifactLimitBytes: this.artifactLimitBytes,
      logLimitBytes: this.logLimitBytes,
      eventRetentionDays: this.eventRetentionDays,
      backupEnabled: this.backupEnabled,
      backupIntervalMinutes: this.backupIntervalMinutes,
      backupRetentionCount: this.backupRetentionCount,
      integrityCheckOnStartup: this.integrityCheckOnStartup,
    });
  }
}

export interface PrivacySettingsSnapshot {
  readonly telemetryEnabled: boolean;
  readonly crashReportingEnabled: boolean;
  readonly performanceMetricsEnabled: boolean;
  readonly diagnosticsRetentionDays: number;
  readonly retainToolTrace: boolean;
  readonly retainProviderResponses: boolean;
}

export class PrivacySettings {
  readonly telemetryEnabled: boolean;
  readonly crashReportingEnabled: boolean;
  readonly performanceMetricsEnabled: boolean;
  readonly diagnosticsRetentionDays: number;
  readonly retainToolTrace: boolean;
  readonly retainProviderResponses: boolean;

  constructor(options: PrivacySettingsSnapshot) {
    this.telemetryEnabled = captureBoolean(options.telemetryEnabled, "Telemetry");
    this.crashReportingEnabled = captureBoolean(
      options.crashReportingEnabled,
      "Crash reporting",
    );
    this.performanceMetricsEnabled = captureBoolean(
      options.performanceMetricsEnabled,
      "Performance metrics",
    );
    this.diagnosticsRetentionDays = captureInteger(
      options.diagnosticsRetentionDays,
      "Diagnostics retention",
      0,
      3_650,
    );
    this.retainToolTrace = captureBoolean(options.retainToolTrace, "Retain Tool trace");
    this.retainProviderResponses = captureBoolean(
      options.retainProviderResponses,
      "Retain Provider responses",
    );
    Object.freeze(this);
  }

  toSnapshot(): PrivacySettingsSnapshot {
    return freezeSnapshot({
      telemetryEnabled: this.telemetryEnabled,
      crashReportingEnabled: this.crashReportingEnabled,
      performanceMetricsEnabled: this.performanceMetricsEnabled,
      diagnosticsRetentionDays: this.diagnosticsRetentionDays,
      retainToolTrace: this.retainToolTrace,
      retainProviderResponses: this.retainProviderResponses,
    });
  }
}

export interface NetworkSettingsSnapshot {
  readonly offlineMode: boolean;
  readonly proxyMode: ProxyMode;
  readonly proxyUrl?: string;
  readonly proxyCredentialRef?: string;
  readonly noProxyHosts: readonly string[];
  readonly customCaPath?: string;
  readonly connectionTimeoutMs: number;
  readonly requestTimeoutMs: number;
  readonly maximumConcurrentRequests: number;
}

export class NetworkSettings {
  readonly offlineMode: boolean;
  readonly proxyMode: ProxyMode;
  readonly proxyUrl?: string;
  readonly proxyCredentialRef?: string;
  readonly noProxyHosts: readonly string[];
  readonly customCaPath?: string;
  readonly connectionTimeoutMs: number;
  readonly requestTimeoutMs: number;
  readonly maximumConcurrentRequests: number;

  constructor(options: NetworkSettingsSnapshot) {
    this.offlineMode = captureBoolean(options.offlineMode, "Offline mode");
    this.proxyMode = captureProxyMode(options.proxyMode);
    this.proxyUrl = captureOptionalNonBlank(options.proxyUrl, "Proxy URL", 4_096);
    this.proxyCredentialRef = captureOptionalNonBlank(
      options.proxyCredentialRef,
      "Proxy credential reference",
      256,
    );
    this.noProxyHosts = captureStringList(options.noProxyHosts, "No-proxy host");
    this.customCaPath = captureOptionalNonBlank(
      options.customCaPath,
      "Custom CA path",
      4_096,
    );
    this.connectionTimeoutMs = captureInteger(
      options.connectionTimeoutMs,
      "Connection timeout",
      100,
      600_000,
    );
    this.requestTimeoutMs = captureInteger(
      options.requestTimeoutMs,
      "Request timeout",
      100,
      3_600_000,
    );
    this.maximumConcurrentRequests = captureInteger(
      options.maximumConcurrentRequests,
      "Maximum concurrent requests",
      1,
      1_024,
    );
    if (this.proxyMode === "custom" && this.proxyUrl === undefined) {
      throw new TypeError("Custom proxy URL is required");
    }
    Object.freeze(this);
  }

  toSnapshot(): NetworkSettingsSnapshot {
    return freezeSnapshot({
      offlineMode: this.offlineMode,
      proxyMode: this.proxyMode,
      ...(this.proxyUrl === undefined ? {} : { proxyUrl: this.proxyUrl }),
      ...(this.proxyCredentialRef === undefined
        ? {}
        : { proxyCredentialRef: this.proxyCredentialRef }),
      noProxyHosts: this.noProxyHosts,
      ...(this.customCaPath === undefined ? {} : { customCaPath: this.customCaPath }),
      connectionTimeoutMs: this.connectionTimeoutMs,
      requestTimeoutMs: this.requestTimeoutMs,
      maximumConcurrentRequests: this.maximumConcurrentRequests,
    });
  }
}

export interface NotificationSettingsSnapshot {
  readonly enabled: boolean;
  readonly agentCompleted: boolean;
  readonly agentFailed: boolean;
  readonly approvalWaiting: boolean;
  readonly subagentCompleted: boolean;
  readonly providerFailure: boolean;
  readonly backupFailure: boolean;
  readonly soundEnabled: boolean;
}

export class NotificationSettings {
  readonly enabled: boolean;
  readonly agentCompleted: boolean;
  readonly agentFailed: boolean;
  readonly approvalWaiting: boolean;
  readonly subagentCompleted: boolean;
  readonly providerFailure: boolean;
  readonly backupFailure: boolean;
  readonly soundEnabled: boolean;

  constructor(options: NotificationSettingsSnapshot) {
    this.enabled = captureBoolean(options.enabled, "Notifications");
    this.agentCompleted = captureBoolean(options.agentCompleted, "Agent completed");
    this.agentFailed = captureBoolean(options.agentFailed, "Agent failed");
    this.approvalWaiting = captureBoolean(options.approvalWaiting, "Approval waiting");
    this.subagentCompleted = captureBoolean(
      options.subagentCompleted,
      "Subagent completed",
    );
    this.providerFailure = captureBoolean(options.providerFailure, "Provider failure");
    this.backupFailure = captureBoolean(options.backupFailure, "Backup failure");
    this.soundEnabled = captureBoolean(options.soundEnabled, "Notification sound");
    Object.freeze(this);
  }

  toSnapshot(): NotificationSettingsSnapshot {
    return freezeSnapshot({
      enabled: this.enabled,
      agentCompleted: this.agentCompleted,
      agentFailed: this.agentFailed,
      approvalWaiting: this.approvalWaiting,
      subagentCompleted: this.subagentCompleted,
      providerFailure: this.providerFailure,
      backupFailure: this.backupFailure,
      soundEnabled: this.soundEnabled,
    });
  }
}

export interface CliSettingsSnapshot {
  readonly outputFormat: CliOutputFormat;
  readonly color: CliColorMode;
  readonly interactive: boolean;
  readonly showToolTrace: boolean;
  readonly showEventTimeline: boolean;
  readonly showPerformanceMetrics: boolean;
  readonly defaultWorkspace?: string;
}

export class CliSettings {
  readonly outputFormat: CliOutputFormat;
  readonly color: CliColorMode;
  readonly interactive: boolean;
  readonly showToolTrace: boolean;
  readonly showEventTimeline: boolean;
  readonly showPerformanceMetrics: boolean;
  readonly defaultWorkspace?: string;

  constructor(options: CliSettingsSnapshot) {
    this.outputFormat = captureCliOutputFormat(options.outputFormat);
    this.color = captureCliColorMode(options.color);
    this.interactive = captureBoolean(options.interactive, "CLI interactive mode");
    this.showToolTrace = captureBoolean(options.showToolTrace, "CLI Tool trace");
    this.showEventTimeline = captureBoolean(
      options.showEventTimeline,
      "CLI Event timeline",
    );
    this.showPerformanceMetrics = captureBoolean(
      options.showPerformanceMetrics,
      "CLI performance metrics",
    );
    this.defaultWorkspace = captureOptionalNonBlank(
      options.defaultWorkspace,
      "CLI default Workspace",
      4_096,
    );
    Object.freeze(this);
  }

  toSnapshot(): CliSettingsSnapshot {
    return freezeSnapshot({
      outputFormat: this.outputFormat,
      color: this.color,
      interactive: this.interactive,
      showToolTrace: this.showToolTrace,
      showEventTimeline: this.showEventTimeline,
      showPerformanceMetrics: this.showPerformanceMetrics,
      ...(this.defaultWorkspace === undefined
        ? {}
        : { defaultWorkspace: this.defaultWorkspace }),
    });
  }
}

export interface GuiSettingsSnapshot {
  readonly restoreWindowState: boolean;
  readonly closeBehavior: "quit" | "background";
  readonly nativeNotifications: boolean;
  readonly hardwareAcceleration: boolean;
  readonly developerToolsEnabled: boolean;
}

export class GuiSettings {
  readonly restoreWindowState: boolean;
  readonly closeBehavior: "quit" | "background";
  readonly nativeNotifications: boolean;
  readonly hardwareAcceleration: boolean;
  readonly developerToolsEnabled: boolean;

  constructor(options: GuiSettingsSnapshot) {
    this.restoreWindowState = captureBoolean(
      options.restoreWindowState,
      "Restore window state",
    );
    this.closeBehavior = captureCloseBehavior(options.closeBehavior);
    this.nativeNotifications = captureBoolean(
      options.nativeNotifications,
      "Native notifications",
    );
    this.hardwareAcceleration = captureBoolean(
      options.hardwareAcceleration,
      "Hardware acceleration",
    );
    this.developerToolsEnabled = captureBoolean(
      options.developerToolsEnabled,
      "Developer tools",
    );
    Object.freeze(this);
  }

  toSnapshot(): GuiSettingsSnapshot {
    return freezeSnapshot({
      restoreWindowState: this.restoreWindowState,
      closeBehavior: this.closeBehavior,
      nativeNotifications: this.nativeNotifications,
      hardwareAcceleration: this.hardwareAcceleration,
      developerToolsEnabled: this.developerToolsEnabled,
    });
  }
}

export interface WebSettingsSnapshot {
  readonly serverUrl?: string;
  readonly autoReconnect: boolean;
  readonly reconnectMaximumDelayMs: number;
  readonly eventSubscriptionRetryLimit: number;
  readonly requestTimeoutMs: number;
}

export class WebSettings {
  readonly serverUrl?: string;
  readonly autoReconnect: boolean;
  readonly reconnectMaximumDelayMs: number;
  readonly eventSubscriptionRetryLimit: number;
  readonly requestTimeoutMs: number;

  constructor(options: WebSettingsSnapshot) {
    this.serverUrl = captureOptionalNonBlank(options.serverUrl, "Web Server URL", 4_096);
    this.autoReconnect = captureBoolean(options.autoReconnect, "Web auto reconnect");
    this.reconnectMaximumDelayMs = captureInteger(
      options.reconnectMaximumDelayMs,
      "Web reconnect maximum delay",
      100,
      600_000,
    );
    this.eventSubscriptionRetryLimit = captureInteger(
      options.eventSubscriptionRetryLimit,
      "Web Event retry limit",
      0,
      10_000,
    );
    this.requestTimeoutMs = captureInteger(
      options.requestTimeoutMs,
      "Web request timeout",
      100,
      3_600_000,
    );
    Object.freeze(this);
  }

  toSnapshot(): WebSettingsSnapshot {
    return freezeSnapshot({
      ...(this.serverUrl === undefined ? {} : { serverUrl: this.serverUrl }),
      autoReconnect: this.autoReconnect,
      reconnectMaximumDelayMs: this.reconnectMaximumDelayMs,
      eventSubscriptionRetryLimit: this.eventSubscriptionRetryLimit,
      requestTimeoutMs: this.requestTimeoutMs,
    });
  }
}

export interface KeybindingSettingsSnapshot {
  readonly bindings: Readonly<Record<string, JsonScalar>>;
}

export class KeybindingSettings {
  readonly bindings: Readonly<Record<string, JsonScalar>>;

  constructor(options: KeybindingSettingsSnapshot) {
    this.bindings = captureScalarRecord(options.bindings, "Keybindings");
    for (const value of Object.values(this.bindings)) {
      if (typeof value !== "string" || value.trim().length === 0) {
        throw new TypeError("Keybinding value is invalid");
      }
    }
    const shortcuts = Object.values(this.bindings) as string[];
    if (new Set(shortcuts).size !== shortcuts.length) {
      throw new TypeError("Keybindings must be unique");
    }
    Object.freeze(this);
  }

  toSnapshot(): KeybindingSettingsSnapshot {
    return freezeSnapshot({ bindings: this.bindings });
  }
}

export interface DiagnosticSettingsSnapshot {
  readonly logLevel: DiagnosticLogLevel;
  readonly eventInspectorEnabled: boolean;
  readonly runtimeStateInspectorEnabled: boolean;
  readonly contextMetricsEnabled: boolean;
  readonly ipcMetricsEnabled: boolean;
  readonly experimentalFeaturesEnabled: boolean;
  readonly providerRequestDumpEnabled?: boolean;
  readonly providerRequestDumpPath?: string;
}

export class DiagnosticSettings {
  readonly logLevel: DiagnosticLogLevel;
  readonly eventInspectorEnabled: boolean;
  readonly runtimeStateInspectorEnabled: boolean;
  readonly contextMetricsEnabled: boolean;
  readonly ipcMetricsEnabled: boolean;
  readonly experimentalFeaturesEnabled: boolean;
  readonly providerRequestDumpEnabled: boolean;
  readonly providerRequestDumpPath?: string;

  constructor(options: DiagnosticSettingsSnapshot) {
    this.logLevel = captureDiagnosticLogLevel(options.logLevel);
    this.eventInspectorEnabled = captureBoolean(
      options.eventInspectorEnabled,
      "Event Inspector",
    );
    this.runtimeStateInspectorEnabled = captureBoolean(
      options.runtimeStateInspectorEnabled,
      "Runtime State Inspector",
    );
    this.contextMetricsEnabled = captureBoolean(
      options.contextMetricsEnabled,
      "Context metrics",
    );
    this.ipcMetricsEnabled = captureBoolean(options.ipcMetricsEnabled, "IPC metrics");
    this.experimentalFeaturesEnabled = captureBoolean(
      options.experimentalFeaturesEnabled,
      "Experimental features",
    );
    this.providerRequestDumpEnabled =
      options.providerRequestDumpEnabled ?? false;
    this.providerRequestDumpPath =
      options.providerRequestDumpPath === undefined
        ? undefined
        : captureOptionalNonBlank(
            options.providerRequestDumpPath,
            "Provider request dump path",
            1024,
          );
    Object.freeze(this);
  }

  toSnapshot(): DiagnosticSettingsSnapshot {
    return freezeSnapshot({
      logLevel: this.logLevel,
      eventInspectorEnabled: this.eventInspectorEnabled,
      runtimeStateInspectorEnabled: this.runtimeStateInspectorEnabled,
      contextMetricsEnabled: this.contextMetricsEnabled,
      ipcMetricsEnabled: this.ipcMetricsEnabled,
      experimentalFeaturesEnabled: this.experimentalFeaturesEnabled,
      providerRequestDumpEnabled: this.providerRequestDumpEnabled,
      ...(this.providerRequestDumpPath === undefined
        ? {}
        : { providerRequestDumpPath: this.providerRequestDumpPath }),
    });
  }
}

function captureStartupBehavior(value: unknown): StartupBehavior {
  if (value !== "welcome" && value !== "reopen_last_workspace") {
    throw new TypeError("Startup behavior is invalid");
  }
  return value;
}

function captureTheme(value: unknown): ThemePreference {
  if (value !== "system" && value !== "light" && value !== "dark") {
    throw new TypeError("Theme is invalid");
  }
  return value;
}

function captureDensity(value: unknown): InterfaceDensity {
  if (value !== "comfortable" && value !== "compact") {
    throw new TypeError("Interface density is invalid");
  }
  return value;
}

function captureSidebar(value: unknown): SidebarPreference {
  if (value !== "expanded" && value !== "collapsed") {
    throw new TypeError("Sidebar preference is invalid");
  }
  return value;
}

function captureProxyMode(value: unknown): ProxyMode {
  if (value !== "system" && value !== "disabled" && value !== "custom") {
    throw new TypeError("Proxy mode is invalid");
  }
  return value;
}

function captureCliOutputFormat(value: unknown): CliOutputFormat {
  if (value !== "text" && value !== "json" && value !== "jsonl") {
    throw new TypeError("CLI output format is invalid");
  }
  return value;
}

function captureCliColorMode(value: unknown): CliColorMode {
  if (value !== "auto" && value !== "always" && value !== "never") {
    throw new TypeError("CLI color mode is invalid");
  }
  return value;
}

function captureCloseBehavior(value: unknown): "quit" | "background" {
  if (value !== "quit" && value !== "background") {
    throw new TypeError("GUI close behavior is invalid");
  }
  return value;
}

function captureAutonomyLevel(value: unknown): AgentAutonomyLevel {
  if (value !== "cautious" && value !== "balanced" && value !== "autonomous") {
    throw new TypeError("Agent autonomy level is invalid");
  }
  return value;
}

function captureDiagnosticLogLevel(value: unknown): DiagnosticLogLevel {
  if (
    value !== "error" &&
    value !== "warn" &&
    value !== "info" &&
    value !== "debug" &&
    value !== "verbose"
  ) {
    throw new TypeError("Diagnostic log level is invalid");
  }
  return value;
}
