/** Resolves effective Conversation settings without mutating persisted Configuration layers. */
import type { ApplicationConfiguration } from "./ApplicationConfiguration.js";
import type { ModelConnection, ModelProfile } from "./ModelConfiguration.js";
import type { RuntimeProfile, ToolPermissionProfile } from "./RuntimeProfile.js";
import type {
  ConversationConfigurationBinding,
  ConversationOutputVerbosity,
  SessionConfigurationOverrides,
  WorkspaceConfiguration,
} from "./ScopedConfiguration.js";

export type EffectiveConfigurationSource =
  | "application"
  | "workspace"
  | "conversation"
  | "session";

export interface EffectiveConfigurationSources {
  readonly agentType: EffectiveConfigurationSource;
  readonly modelProfile?: EffectiveConfigurationSource;
  readonly runtimeProfile: EffectiveConfigurationSource;
  readonly toolPermissionProfile: EffectiveConfigurationSource;
  readonly responseLanguage: EffectiveConfigurationSource;
  readonly subagentsEnabled: EffectiveConfigurationSource;
  readonly outputVerbosity: EffectiveConfigurationSource;
}

export interface EffectiveConfigurationResolveRequest {
  readonly application: ApplicationConfiguration;
  readonly workspace?: WorkspaceConfiguration;
  readonly conversation?: ConversationConfigurationBinding;
  readonly session?: SessionConfigurationOverrides;
}

export class EffectiveConversationConfiguration {
  readonly agentType: string;
  readonly modelProfile?: ModelProfile;
  readonly modelConnection?: ModelConnection;
  readonly runtimeProfile: RuntimeProfile;
  readonly toolPermissionProfile: ToolPermissionProfile;
  readonly responseLanguage: string;
  readonly subagentsEnabled: boolean;
  readonly outputVerbosity: ConversationOutputVerbosity;
  readonly allowToolsOutsideWorkspace: boolean;
  readonly sources: EffectiveConfigurationSources;

  constructor(options: {
    readonly agentType: string;
    readonly modelProfile?: ModelProfile;
    readonly modelConnection?: ModelConnection;
    readonly runtimeProfile: RuntimeProfile;
    readonly toolPermissionProfile: ToolPermissionProfile;
    readonly responseLanguage: string;
    readonly subagentsEnabled: boolean;
    readonly outputVerbosity: ConversationOutputVerbosity;
    readonly allowToolsOutsideWorkspace: boolean;
    readonly sources: EffectiveConfigurationSources;
  }) {
    this.agentType = options.agentType;
    this.modelProfile = options.modelProfile;
    this.modelConnection = options.modelConnection;
    this.runtimeProfile = options.runtimeProfile;
    this.toolPermissionProfile = options.toolPermissionProfile;
    this.responseLanguage = options.responseLanguage;
    this.subagentsEnabled = options.subagentsEnabled;
    this.outputVerbosity = options.outputVerbosity;
    this.allowToolsOutsideWorkspace = options.allowToolsOutsideWorkspace;
    this.sources = Object.freeze({ ...options.sources });
    Object.freeze(this);
  }
}

export class EffectiveConfigurationResolver {
  resolve(
    request: EffectiveConfigurationResolveRequest,
  ): EffectiveConversationConfiguration {
    const agentType = choose(
      request.application.general.defaultAgentType,
      request.workspace?.defaultAgentType,
      request.conversation?.agentType,
      request.session?.agentType,
    );
    const modelProfileId = chooseOptional(
      request.application.defaultModelProfileId,
      request.workspace?.defaultModelProfileId,
      request.conversation?.modelProfileId,
      request.session?.modelProfileId,
    );
    const runtimeProfileId = choose(
      request.application.defaultRuntimeProfileId,
      request.workspace?.defaultRuntimeProfileId,
      request.conversation?.runtimeProfileId,
      request.session?.runtimeProfileId,
    );
    const toolPermissionProfileId = choose(
      request.application.defaultToolPermissionProfileId,
      request.workspace?.defaultToolPermissionProfileId,
      request.conversation?.toolPermissionProfileId,
      request.session?.toolPermissionProfileId,
    );
    const responseLanguage = choose(
      request.application.agent.responseLanguage,
      undefined,
      request.conversation?.responseLanguage,
      request.session?.responseLanguage,
    );
    const requestedSubagents = choose(
      request.application.agent.useSubagents,
      request.workspace?.subagentsEnabled,
      request.conversation?.subagentsEnabled,
      request.session?.subagentsEnabled,
    );
    const outputVerbosity = choose<ConversationOutputVerbosity>(
      "balanced",
      undefined,
      request.conversation?.outputVerbosity,
      request.session?.outputVerbosity,
    );

    const runtimeProfile = requireResolved(
      request.application.getRuntimeProfile(runtimeProfileId.value),
      "Runtime Profile",
    );
    const toolPermissionProfile = requireResolved(
      request.application.getToolPermissionProfile(toolPermissionProfileId.value),
      "Tool Permission Profile",
    );
    const modelProfile = modelProfileId === undefined
      ? undefined
      : requireResolved(
        request.application.getModelProfile(modelProfileId.value),
        "Model Profile",
      );
    const modelConnection = modelProfile === undefined
      ? undefined
      : requireResolved(
        request.application.getModelConnection(modelProfile.connectionId),
        "Model Connection",
      );

    return new EffectiveConversationConfiguration({
      agentType: agentType.value,
      ...(modelProfile === undefined ? {} : { modelProfile }),
      ...(modelConnection === undefined ? {} : { modelConnection }),
      runtimeProfile,
      toolPermissionProfile,
      responseLanguage: responseLanguage.value,
      subagentsEnabled: requestedSubagents.value && runtimeProfile.subagents.enabled,
      outputVerbosity: outputVerbosity.value,
      allowToolsOutsideWorkspace:
        request.workspace?.allowToolsOutsideWorkspace === true &&
        (toolPermissionProfile.filesystem.outsideWorkspaceRead ||
          toolPermissionProfile.filesystem.outsideWorkspaceWrite),
      sources: Object.freeze({
        agentType: agentType.source,
        ...(modelProfileId === undefined
          ? {}
          : { modelProfile: modelProfileId.source }),
        runtimeProfile: runtimeProfileId.source,
        toolPermissionProfile: toolPermissionProfileId.source,
        responseLanguage: responseLanguage.source,
        subagentsEnabled: requestedSubagents.source,
        outputVerbosity: outputVerbosity.source,
      }),
    });
  }
}

interface SelectedValue<TValue> {
  readonly value: TValue;
  readonly source: EffectiveConfigurationSource;
}

function choose<TValue>(
  application: TValue,
  workspace: TValue | undefined,
  conversation: TValue | undefined,
  session: TValue | undefined,
): SelectedValue<TValue> {
  if (session !== undefined) return { value: session, source: "session" };
  if (conversation !== undefined) {
    return { value: conversation, source: "conversation" };
  }
  if (workspace !== undefined) return { value: workspace, source: "workspace" };
  return { value: application, source: "application" };
}

function chooseOptional<TValue>(
  application: TValue | undefined,
  workspace: TValue | undefined,
  conversation: TValue | undefined,
  session: TValue | undefined,
): SelectedValue<TValue> | undefined {
  if (session !== undefined) return { value: session, source: "session" };
  if (conversation !== undefined) {
    return { value: conversation, source: "conversation" };
  }
  if (workspace !== undefined) return { value: workspace, source: "workspace" };
  return application === undefined
    ? undefined
    : { value: application, source: "application" };
}

function requireResolved<TValue>(
  value: TValue | undefined,
  label: string,
): TValue {
  if (value === undefined) throw new TypeError(`${label} is unknown`);
  return value;
}
