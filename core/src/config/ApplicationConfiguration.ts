/** Aggregate user Configuration document with validated Profile catalogs and defaults. */
import {
  AgentPreferenceSettings,
  AppearanceSettings,
  CliSettings,
  DiagnosticSettings,
  EditorSettings,
  GeneralSettings,
  GuiSettings,
  KeybindingSettings,
  NetworkSettings,
  NotificationSettings,
  PrivacySettings,
  StorageSettings,
  WebSettings,
  type AgentPreferenceSettingsSnapshot,
  type AppearanceSettingsSnapshot,
  type CliSettingsSnapshot,
  type DiagnosticSettingsSnapshot,
  type EditorSettingsSnapshot,
  type GeneralSettingsSnapshot,
  type GuiSettingsSnapshot,
  type KeybindingSettingsSnapshot,
  type NetworkSettingsSnapshot,
  type NotificationSettingsSnapshot,
  type PrivacySettingsSnapshot,
  type StorageSettingsSnapshot,
  type WebSettingsSnapshot,
} from "./ApplicationSettings.js";
import {
  inferDefaultModelApi,
  ModelConnection,
  ModelProfile,
  type ModelConnectionSnapshot,
  type ModelProfileSnapshot,
} from "./ModelConfiguration.js";
import {
  RuntimeProfile,
  ToolPermissionProfile,
  type RuntimeProfileSnapshot,
  type ToolPermissionProfileSnapshot,
} from "./RuntimeProfile.js";
import {
  captureIdentity,
  captureInteger,
  freezeSnapshot,
} from "./ConfigurationValues.js";

export const APPLICATION_CONFIGURATION_SCHEMA_VERSION = 1 as const;

export interface ApplicationConfigurationSnapshot {
  readonly schemaVersion: typeof APPLICATION_CONFIGURATION_SCHEMA_VERSION;
  readonly revision: number;
  readonly general: GeneralSettingsSnapshot;
  readonly agent: AgentPreferenceSettingsSnapshot;
  readonly appearance: AppearanceSettingsSnapshot;
  readonly editor: EditorSettingsSnapshot;
  readonly storage: StorageSettingsSnapshot;
  readonly privacy: PrivacySettingsSnapshot;
  readonly network: NetworkSettingsSnapshot;
  readonly notifications: NotificationSettingsSnapshot;
  readonly cli: CliSettingsSnapshot;
  readonly gui: GuiSettingsSnapshot;
  readonly web: WebSettingsSnapshot;
  readonly keybindings: KeybindingSettingsSnapshot;
  readonly diagnostics: DiagnosticSettingsSnapshot;
  readonly modelConnections: readonly ModelConnectionSnapshot[];
  readonly modelProfiles: readonly ModelProfileSnapshot[];
  readonly runtimeProfiles: readonly RuntimeProfileSnapshot[];
  readonly toolPermissionProfiles: readonly ToolPermissionProfileSnapshot[];
  readonly defaultModelProfileId?: string;
  readonly defaultRuntimeProfileId: string;
  readonly defaultToolPermissionProfileId: string;
}

export class ApplicationConfiguration {
  readonly schemaVersion = APPLICATION_CONFIGURATION_SCHEMA_VERSION;
  readonly revision: number;
  readonly general: GeneralSettings;
  readonly agent: AgentPreferenceSettings;
  readonly appearance: AppearanceSettings;
  readonly editor: EditorSettings;
  readonly storage: StorageSettings;
  readonly privacy: PrivacySettings;
  readonly network: NetworkSettings;
  readonly notifications: NotificationSettings;
  readonly cli: CliSettings;
  readonly gui: GuiSettings;
  readonly web: WebSettings;
  readonly keybindings: KeybindingSettings;
  readonly diagnostics: DiagnosticSettings;
  readonly modelConnections: readonly ModelConnection[];
  readonly modelProfiles: readonly ModelProfile[];
  readonly runtimeProfiles: readonly RuntimeProfile[];
  readonly toolPermissionProfiles: readonly ToolPermissionProfile[];
  readonly defaultModelProfileId?: string;
  readonly defaultRuntimeProfileId: string;
  readonly defaultToolPermissionProfileId: string;

  constructor(snapshot: ApplicationConfigurationSnapshot) {
    if (snapshot.schemaVersion !== APPLICATION_CONFIGURATION_SCHEMA_VERSION) {
      throw new TypeError("Application Configuration schema version is unsupported");
    }
    this.revision = captureInteger(snapshot.revision, "Configuration revision", 0, 2 ** 31 - 1);
    this.general = new GeneralSettings(snapshot.general);
    this.agent = new AgentPreferenceSettings(snapshot.agent);
    this.appearance = new AppearanceSettings(snapshot.appearance);
    this.editor = new EditorSettings(snapshot.editor);
    this.storage = new StorageSettings(snapshot.storage);
    this.privacy = new PrivacySettings(snapshot.privacy);
    this.network = new NetworkSettings(snapshot.network);
    this.notifications = new NotificationSettings(snapshot.notifications);
    this.cli = new CliSettings(snapshot.cli);
    this.gui = new GuiSettings(snapshot.gui);
    this.web = new WebSettings(snapshot.web);
    this.keybindings = new KeybindingSettings(snapshot.keybindings);
    this.diagnostics = new DiagnosticSettings(snapshot.diagnostics);
    this.modelConnections = captureUnique(
      snapshot.modelConnections.map((connection) => new ModelConnection(connection)),
      "Model Connection",
    );
    const modelConnectionsById = new Map(
      this.modelConnections.map((connection) => [connection.id, connection] as const),
    );
    this.modelProfiles = captureUnique(
      snapshot.modelProfiles.map((profile) => {
        const connection = modelConnectionsById.get(profile.connectionId);
        return new ModelProfile(
          profile,
          connection === undefined
            ? "openai-responses"
            : inferDefaultModelApi(connection.providerKind),
        );
      }),
      "Model Profile",
    );
    this.runtimeProfiles = captureRequiredUnique(
      snapshot.runtimeProfiles.map((profile) => new RuntimeProfile(profile)),
      "Runtime Profile",
    );
    this.toolPermissionProfiles = captureRequiredUnique(
      snapshot.toolPermissionProfiles.map(
        (profile) => new ToolPermissionProfile(profile),
      ),
      "Tool Permission Profile",
    );
    this.defaultModelProfileId = snapshot.defaultModelProfileId === undefined
      ? undefined
      : captureIdentity(snapshot.defaultModelProfileId, "Default Model Profile ID");
    this.defaultRuntimeProfileId = captureIdentity(
      snapshot.defaultRuntimeProfileId,
      "Default Runtime Profile ID",
    );
    this.defaultToolPermissionProfileId = captureIdentity(
      snapshot.defaultToolPermissionProfileId,
      "Default Tool Permission Profile ID",
    );
    this.#assertCatalogReferences();
    Object.freeze(this);
  }

  getModelConnection(id: string): ModelConnection | undefined {
    return this.modelConnections.find((connection) => connection.id === id);
  }

  getModelProfile(id: string): ModelProfile | undefined {
    return this.modelProfiles.find((profile) => profile.id === id);
  }

  getRuntimeProfile(id: string): RuntimeProfile | undefined {
    return this.runtimeProfiles.find((profile) => profile.id === id);
  }

  getToolPermissionProfile(id: string): ToolPermissionProfile | undefined {
    return this.toolPermissionProfiles.find((profile) => profile.id === id);
  }

  toSnapshot(): ApplicationConfigurationSnapshot {
    return freezeSnapshot({
      schemaVersion: this.schemaVersion,
      revision: this.revision,
      general: this.general.toSnapshot(),
      agent: this.agent.toSnapshot(),
      appearance: this.appearance.toSnapshot(),
      editor: this.editor.toSnapshot(),
      storage: this.storage.toSnapshot(),
      privacy: this.privacy.toSnapshot(),
      network: this.network.toSnapshot(),
      notifications: this.notifications.toSnapshot(),
      cli: this.cli.toSnapshot(),
      gui: this.gui.toSnapshot(),
      web: this.web.toSnapshot(),
      keybindings: this.keybindings.toSnapshot(),
      diagnostics: this.diagnostics.toSnapshot(),
      modelConnections: Object.freeze(
        this.modelConnections.map((connection) => connection.toSnapshot()),
      ),
      modelProfiles: Object.freeze(
        this.modelProfiles.map((profile) => profile.toSnapshot()),
      ),
      runtimeProfiles: Object.freeze(
        this.runtimeProfiles.map((profile) => profile.toSnapshot()),
      ),
      toolPermissionProfiles: Object.freeze(
        this.toolPermissionProfiles.map((profile) => profile.toSnapshot()),
      ),
      ...(this.defaultModelProfileId === undefined
        ? {}
        : { defaultModelProfileId: this.defaultModelProfileId }),
      defaultRuntimeProfileId: this.defaultRuntimeProfileId,
      defaultToolPermissionProfileId: this.defaultToolPermissionProfileId,
    });
  }

  #assertCatalogReferences(): void {
    const connectionIds = new Set(this.modelConnections.map((connection) => connection.id));
    const profileIds = new Set(this.modelProfiles.map((profile) => profile.id));
    for (const profile of this.modelProfiles) {
      if (!connectionIds.has(profile.connectionId)) {
        throw new TypeError("Model Profile references an unknown Model Connection");
      }
      for (const fallbackId of profile.fallbackProfileIds) {
        if (!profileIds.has(fallbackId)) {
          throw new TypeError("Model Profile references an unknown fallback Profile");
        }
      }
    }
    assertNoFallbackCycles(this.modelProfiles);
    if (
      this.defaultModelProfileId !== undefined &&
      !profileIds.has(this.defaultModelProfileId)
    ) {
      throw new TypeError("Default Model Profile is unknown");
    }
    if (!this.getRuntimeProfile(this.defaultRuntimeProfileId)) {
      throw new TypeError("Default Runtime Profile is unknown");
    }
    if (!this.getToolPermissionProfile(this.defaultToolPermissionProfileId)) {
      throw new TypeError("Default Tool Permission Profile is unknown");
    }
  }
}

export function createDefaultApplicationConfiguration(): ApplicationConfiguration {
  return new ApplicationConfiguration({
    schemaVersion: APPLICATION_CONFIGURATION_SCHEMA_VERSION,
    revision: 0,
    general: {
      locale: "zh-CN",
      startupBehavior: "welcome",
      reopenLastWorkspace: true,
      confirmBeforeExit: false,
      checkForUpdates: true,
      autoUpdateEnabled: false,
      defaultAgentType: "novel",
    },
    agent: {
      responseLanguage: "auto",
      autonomyLevel: "balanced",
      useTodos: true,
      useSubagents: true,
      allowBackgroundTasks: true,
      summarizeOnCompletion: true,
      askBeforeCreativeDecisions: true,
      showInternalState: false,
      showPolicyEvents: false,
    },
    appearance: {
      theme: "system",
      interfaceScalePercent: 100,
      density: "comfortable",
      sidebar: "expanded",
      reduceMotion: false,
      highContrast: false,
      showEventTimestamps: false,
      showToolTrace: true,
      showPerformanceMetrics: false,
    },
    editor: {
      fontFamily: "system-ui",
      fontSize: 16,
      lineHeightPercent: 175,
      contentWidth: 840,
      spellcheck: true,
      smartPunctuation: true,
      showWordCount: true,
      showBlockBoundaries: false,
      autosaveEnabled: true,
      autosaveDelayMs: 750,
    },
    storage: {
      cacheLimitBytes: 2_147_483_648,
      artifactLimitBytes: 10_737_418_240,
      logLimitBytes: 268_435_456,
      eventRetentionDays: 365,
      backupEnabled: true,
      backupIntervalMinutes: 60,
      backupRetentionCount: 20,
      integrityCheckOnStartup: true,
    },
    privacy: {
      telemetryEnabled: false,
      crashReportingEnabled: false,
      performanceMetricsEnabled: false,
      diagnosticsRetentionDays: 14,
      retainToolTrace: true,
      retainProviderResponses: false,
    },
    network: {
      offlineMode: false,
      proxyMode: "system",
      noProxyHosts: [],
      connectionTimeoutMs: 15_000,
      requestTimeoutMs: 120_000,
      maximumConcurrentRequests: 16,
    },
    notifications: {
      enabled: true,
      agentCompleted: true,
      agentFailed: true,
      approvalWaiting: true,
      subagentCompleted: true,
      providerFailure: true,
      backupFailure: true,
      soundEnabled: false,
    },
    cli: {
      outputFormat: "text",
      color: "auto",
      interactive: true,
      showToolTrace: true,
      showEventTimeline: false,
      showPerformanceMetrics: false,
    },
    gui: {
      restoreWindowState: true,
      closeBehavior: "quit",
      nativeNotifications: true,
      hardwareAcceleration: true,
      developerToolsEnabled: false,
    },
    web: {
      autoReconnect: true,
      reconnectMaximumDelayMs: 30_000,
      eventSubscriptionRetryLimit: 20,
      requestTimeoutMs: 120_000,
    },
    keybindings: {
      bindings: {
        "conversation.new": "Mod+N",
        "workspace.open": "Mod+O",
        "settings.open": "Mod+,",
        "conversation.stop": "Escape",
        "composer.focus": "Mod+L",
      },
    },
    diagnostics: {
      logLevel: "info",
      eventInspectorEnabled: false,
      runtimeStateInspectorEnabled: false,
      contextMetricsEnabled: false,
      ipcMetricsEnabled: false,
      experimentalFeaturesEnabled: false,
    },
    modelConnections: [],
    modelProfiles: [],
    runtimeProfiles: [DEFAULT_RUNTIME_PROFILE],
    toolPermissionProfiles: [DEFAULT_TOOL_PERMISSION_PROFILE],
    defaultRuntimeProfileId: "default",
    defaultToolPermissionProfileId: "default",
  });
}

const DEFAULT_RUNTIME_PROFILE: RuntimeProfileSnapshot = {
  id: "default",
  displayName: "Balanced",
  preset: "balanced",
  contextPolicyId: "default",
  nudgePolicyId: "default",
  turns: {
    maximumTurns: 40,
    maximumProviderCallsPerTurn: 2,
    maximumToolCallsPerTurn: 32,
    maximumConsecutiveErrors: 3,
    providerCallTimeoutMs: 120_000,
    toolExecutionTimeoutMs: 300_000,
    conversationIdleTimeoutMs: 3_600_000,
    stopGracePeriodMs: 5_000,
    providerRetryMaximumAttempts: 3,
    providerRetryInitialBackoffMs: 500,
    providerRetryMaximumBackoffMs: 8_000,
    retryRateLimits: true,
    retryServerErrors: true,
    fallbackOnProviderFailure: true,
  },
  context: {
    preset: "balanced",
    maximumContextTokens: 128_000,
    providerReserveTokens: 8_192,
    compactionTriggerRatio: 0.82,
    compactionTargetRatio: 0.6,
    recentWindowTokens: 32_000,
    maximumCheckpointTokens: 16_000,
    maximumPinnedTokens: 16_000,
    oversizedContentThresholdBytes: 1_048_576,
    oversizedContentRetentionDays: 30,
    preserveRecentToolResults: true,
    preserveIncompleteTodos: true,
    preserveRecentUserConstraints: true,
    modelAssistedCompaction: true,
    compactionMaximumAttempts: 2,
    compactionTimeoutMs: 60_000,
  },
  nudge: {
    enabled: true,
    maximumPerProviderCall: 2,
    maximumTurnsReminderEnabled: true,
    toolIdleReminderEnabled: true,
    todoIdleReminderEnabled: true,
    contextPressureReminderEnabled: true,
    completionReminderEnabled: true,
    approvalWaitingReminderEnabled: true,
    subagentWaitingReminderEnabled: true,
    cooldownTurns: 1,
    suppressDuplicates: true,
  },
  subagents: {
    enabled: true,
    maximumConcurrency: 4,
    maximumDepth: 3,
    maximumTotalChildren: 32,
    maximumChildrenPerTurn: 8,
    defaultTimeoutMs: 600_000,
    retentionPolicy: "discard",
    retentionDays: 0,
    inheritModelProfile: true,
    allowModelOverride: true,
    inheritToolPermissions: true,
    maximumOutputBytes: 8_388_608,
    cascadeCancellation: true,
    retryFailures: false,
  },
  todos: {
    automaticPlanningEnabled: true,
    suggestedMinimumSteps: 3,
    maximumTodos: 100,
    showCompletedTodos: true,
    completedTodoRetentionCount: 20,
    injectAtTurnStart: true,
    idleReminderEnabled: true,
  },
};

const DEFAULT_TOOL_PERMISSION_PROFILE: ToolPermissionProfileSnapshot = {
  id: "default",
  displayName: "Standard Workspace",
  approvalMode: "ask_on_write",
  approvalTimeoutMs: 300_000,
  rememberConversationDecisions: true,
  filesystem: {
    workspaceRead: true,
    workspaceWrite: true,
    outsideWorkspaceRead: false,
    outsideWorkspaceWrite: false,
    deleteAllowed: false,
    overwriteAllowed: true,
    followSymbolicLinks: false,
    additionalAllowedRoots: [],
    deniedRoots: [],
    maximumReadBytes: 67_108_864,
    maximumWriteBytes: 67_108_864,
  },
  process: {
    enabled: false,
    allowedCommands: [],
    deniedCommands: [],
    allowedEnvironmentVariables: [],
    interactiveProcesses: false,
    backgroundProcesses: false,
    maximumConcurrentProcesses: 4,
    maximumExecutionMs: 300_000,
    maximumOutputBytes: 8_388_608,
  },
  network: {
    enabled: false,
    allowedHosts: [],
    deniedHosts: [],
    localNetworkAllowed: false,
    loopbackAllowed: false,
    insecureHttpAllowed: false,
    maximumDownloadBytes: 67_108_864,
    maximumConcurrentRequests: 8,
    requestTimeoutMs: 120_000,
  },
  sandbox: {
    mode: "workspace",
    processIsolation: "auto",
    networkIsolation: true,
    cleanupTemporaryFiles: true,
    maximumTemporaryBytes: 2_147_483_648,
    maximumMemoryBytes: 4_294_967_296,
    maximumCpuTimeMs: 600_000,
  },
};

function captureUnique<TValue extends { readonly id: string }>(
  values: readonly TValue[],
  label: string,
): readonly TValue[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id)) throw new TypeError(`${label} is duplicated`);
    seen.add(value.id);
  }
  return Object.freeze([...values]);
}

function captureRequiredUnique<TValue extends { readonly id: string }>(
  values: readonly TValue[],
  label: string,
): readonly TValue[] {
  if (values.length === 0) throw new TypeError(`${label} catalog is empty`);
  return captureUnique(values, label);
}

function assertNoFallbackCycles(profiles: readonly ModelProfile[]): void {
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (profileId: string): void => {
    if (visited.has(profileId)) return;
    if (visiting.has(profileId)) {
      throw new TypeError("Model Profile fallback cycle is invalid");
    }
    visiting.add(profileId);
    for (const fallbackId of byId.get(profileId)?.fallbackProfileIds ?? []) {
      visit(fallbackId);
    }
    visiting.delete(profileId);
    visited.add(profileId);
  };
  for (const profile of profiles) visit(profile.id);
}
