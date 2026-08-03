/** Workspace overrides, Conversation bindings, and ephemeral Session overrides. */
import {
  captureBoolean,
  captureIdentity,
  captureInteger,
  captureNonBlank,
  captureOptionalNonBlank,
  freezeSnapshot,
} from "./ConfigurationValues.js";

export const WORKSPACE_CONFIGURATION_SCHEMA_VERSION = 1 as const;
export const CONVERSATION_CONFIGURATION_BINDING_SCHEMA_VERSION = 1 as const;

export type ConversationOutputVerbosity = "concise" | "balanced" | "detailed";

export interface WorkspaceConfigurationSnapshot {
  readonly schemaVersion: typeof WORKSPACE_CONFIGURATION_SCHEMA_VERSION;
  readonly revision: number;
  readonly workspaceId: string;
  readonly displayName?: string;
  readonly defaultAgentType?: string;
  readonly defaultModelProfileId?: string;
  readonly defaultRuntimeProfileId?: string;
  readonly defaultToolPermissionProfileId?: string;
  readonly subagentsEnabled?: boolean;
  readonly autosaveEnabled: boolean;
  readonly automaticBackupEnabled: boolean;
  readonly restoreConversationsOnOpen: boolean;
  readonly prepareRuntimeHostOnOpen: boolean;
  readonly allowToolsOutsideWorkspace: boolean;
  readonly recoverDraftsAutomatically: boolean;
  readonly draftRetentionDays: number;
  readonly artifactLimitBytes: number;
  readonly cacheLimitBytes: number;
}

export class WorkspaceConfiguration {
  readonly schemaVersion = WORKSPACE_CONFIGURATION_SCHEMA_VERSION;
  readonly revision: number;
  readonly workspaceId: string;
  readonly displayName?: string;
  readonly defaultAgentType?: string;
  readonly defaultModelProfileId?: string;
  readonly defaultRuntimeProfileId?: string;
  readonly defaultToolPermissionProfileId?: string;
  readonly subagentsEnabled?: boolean;
  readonly autosaveEnabled: boolean;
  readonly automaticBackupEnabled: boolean;
  readonly restoreConversationsOnOpen: boolean;
  readonly prepareRuntimeHostOnOpen: boolean;
  readonly allowToolsOutsideWorkspace: boolean;
  readonly recoverDraftsAutomatically: boolean;
  readonly draftRetentionDays: number;
  readonly artifactLimitBytes: number;
  readonly cacheLimitBytes: number;

  constructor(snapshot: WorkspaceConfigurationSnapshot) {
    if (snapshot.schemaVersion !== WORKSPACE_CONFIGURATION_SCHEMA_VERSION) {
      throw new TypeError("Workspace Configuration schema version is unsupported");
    }
    this.revision = captureInteger(snapshot.revision, "Workspace revision", 0, 2 ** 31 - 1);
    this.workspaceId = captureIdentity(snapshot.workspaceId, "Workspace ID");
    this.displayName = captureOptionalNonBlank(snapshot.displayName, "Workspace name", 256);
    this.defaultAgentType = captureOptionalIdentity(snapshot.defaultAgentType, "Agent type");
    this.defaultModelProfileId = captureOptionalIdentity(
      snapshot.defaultModelProfileId,
      "Model Profile ID",
    );
    this.defaultRuntimeProfileId = captureOptionalIdentity(
      snapshot.defaultRuntimeProfileId,
      "Runtime Profile ID",
    );
    this.defaultToolPermissionProfileId = captureOptionalIdentity(
      snapshot.defaultToolPermissionProfileId,
      "Tool Permission Profile ID",
    );
    this.subagentsEnabled = captureOptionalBoolean(
      snapshot.subagentsEnabled,
      "Workspace Subagents",
    );
    this.autosaveEnabled = captureBoolean(snapshot.autosaveEnabled, "Workspace autosave");
    this.automaticBackupEnabled = captureBoolean(
      snapshot.automaticBackupEnabled,
      "Workspace automatic backup",
    );
    this.restoreConversationsOnOpen = captureBoolean(
      snapshot.restoreConversationsOnOpen,
      "Restore Conversations",
    );
    this.prepareRuntimeHostOnOpen = captureBoolean(
      snapshot.prepareRuntimeHostOnOpen,
      "Prepare Runtime Host",
    );
    this.allowToolsOutsideWorkspace = captureBoolean(
      snapshot.allowToolsOutsideWorkspace,
      "Tools outside Workspace",
    );
    this.recoverDraftsAutomatically = captureBoolean(
      snapshot.recoverDraftsAutomatically,
      "Recover Drafts",
    );
    this.draftRetentionDays = captureInteger(
      snapshot.draftRetentionDays,
      "Draft retention",
      0,
      3_650,
    );
    this.artifactLimitBytes = captureInteger(
      snapshot.artifactLimitBytes,
      "Workspace Artifact limit",
      1_048_576,
      Number.MAX_SAFE_INTEGER,
    );
    this.cacheLimitBytes = captureInteger(
      snapshot.cacheLimitBytes,
      "Workspace Cache limit",
      1_048_576,
      Number.MAX_SAFE_INTEGER,
    );
    Object.freeze(this);
  }

  toSnapshot(): WorkspaceConfigurationSnapshot {
    return freezeSnapshot({
      schemaVersion: this.schemaVersion,
      revision: this.revision,
      workspaceId: this.workspaceId,
      ...(this.displayName === undefined ? {} : { displayName: this.displayName }),
      ...(this.defaultAgentType === undefined
        ? {}
        : { defaultAgentType: this.defaultAgentType }),
      ...(this.defaultModelProfileId === undefined
        ? {}
        : { defaultModelProfileId: this.defaultModelProfileId }),
      ...(this.defaultRuntimeProfileId === undefined
        ? {}
        : { defaultRuntimeProfileId: this.defaultRuntimeProfileId }),
      ...(this.defaultToolPermissionProfileId === undefined
        ? {}
        : { defaultToolPermissionProfileId: this.defaultToolPermissionProfileId }),
      ...(this.subagentsEnabled === undefined
        ? {}
        : { subagentsEnabled: this.subagentsEnabled }),
      autosaveEnabled: this.autosaveEnabled,
      automaticBackupEnabled: this.automaticBackupEnabled,
      restoreConversationsOnOpen: this.restoreConversationsOnOpen,
      prepareRuntimeHostOnOpen: this.prepareRuntimeHostOnOpen,
      allowToolsOutsideWorkspace: this.allowToolsOutsideWorkspace,
      recoverDraftsAutomatically: this.recoverDraftsAutomatically,
      draftRetentionDays: this.draftRetentionDays,
      artifactLimitBytes: this.artifactLimitBytes,
      cacheLimitBytes: this.cacheLimitBytes,
    });
  }
}

export interface ConversationConfigurationBindingSnapshot {
  readonly schemaVersion: typeof CONVERSATION_CONFIGURATION_BINDING_SCHEMA_VERSION;
  readonly conversationId: string;
  readonly agentType?: string;
  readonly modelProfileId?: string;
  readonly runtimeProfileId?: string;
  readonly toolPermissionProfileId?: string;
  readonly responseLanguage?: string;
  readonly subagentsEnabled?: boolean;
  readonly outputVerbosity: ConversationOutputVerbosity;
}

export class ConversationConfigurationBinding {
  readonly schemaVersion = CONVERSATION_CONFIGURATION_BINDING_SCHEMA_VERSION;
  readonly conversationId: string;
  readonly agentType?: string;
  readonly modelProfileId?: string;
  readonly runtimeProfileId?: string;
  readonly toolPermissionProfileId?: string;
  readonly responseLanguage?: string;
  readonly subagentsEnabled?: boolean;
  readonly outputVerbosity: ConversationOutputVerbosity;

  constructor(snapshot: ConversationConfigurationBindingSnapshot) {
    if (snapshot.schemaVersion !== CONVERSATION_CONFIGURATION_BINDING_SCHEMA_VERSION) {
      throw new TypeError("Conversation Configuration schema version is unsupported");
    }
    this.conversationId = captureIdentity(snapshot.conversationId, "Conversation ID");
    this.agentType = captureOptionalIdentity(snapshot.agentType, "Agent type");
    this.modelProfileId = captureOptionalIdentity(
      snapshot.modelProfileId,
      "Model Profile ID",
    );
    this.runtimeProfileId = captureOptionalIdentity(
      snapshot.runtimeProfileId,
      "Runtime Profile ID",
    );
    this.toolPermissionProfileId = captureOptionalIdentity(
      snapshot.toolPermissionProfileId,
      "Tool Permission Profile ID",
    );
    this.responseLanguage = captureOptionalNonBlank(
      snapshot.responseLanguage,
      "Response language",
      64,
    );
    this.subagentsEnabled = captureOptionalBoolean(
      snapshot.subagentsEnabled,
      "Conversation Subagents",
    );
    this.outputVerbosity = captureOutputVerbosity(snapshot.outputVerbosity);
    Object.freeze(this);
  }

  toSnapshot(): ConversationConfigurationBindingSnapshot {
    return freezeSnapshot({
      schemaVersion: this.schemaVersion,
      conversationId: this.conversationId,
      ...(this.agentType === undefined ? {} : { agentType: this.agentType }),
      ...(this.modelProfileId === undefined
        ? {}
        : { modelProfileId: this.modelProfileId }),
      ...(this.runtimeProfileId === undefined
        ? {}
        : { runtimeProfileId: this.runtimeProfileId }),
      ...(this.toolPermissionProfileId === undefined
        ? {}
        : { toolPermissionProfileId: this.toolPermissionProfileId }),
      ...(this.responseLanguage === undefined
        ? {}
        : { responseLanguage: this.responseLanguage }),
      ...(this.subagentsEnabled === undefined
        ? {}
        : { subagentsEnabled: this.subagentsEnabled }),
      outputVerbosity: this.outputVerbosity,
    });
  }
}

export interface SessionConfigurationOverrides {
  readonly agentType?: string;
  readonly modelProfileId?: string;
  readonly runtimeProfileId?: string;
  readonly toolPermissionProfileId?: string;
  readonly responseLanguage?: string;
  readonly subagentsEnabled?: boolean;
  readonly outputVerbosity?: ConversationOutputVerbosity;
}

function captureOptionalIdentity(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : captureIdentity(value, label);
}

function captureOptionalBoolean(value: unknown, label: string): boolean | undefined {
  return value === undefined ? undefined : captureBoolean(value, label);
}

function captureOutputVerbosity(value: unknown): ConversationOutputVerbosity {
  if (value !== "concise" && value !== "balanced" && value !== "detailed") {
    throw new TypeError("Conversation output verbosity is invalid");
  }
  return value;
}
