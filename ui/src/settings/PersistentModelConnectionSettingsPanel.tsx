/** Persists Model Connections, Model Profiles, credentials, and the default model. */
import type {
  ApplicationConfigurationSnapshot,
  ModelApi,
  ModelConnectionSnapshot,
  ModelProfileSnapshot,
  ProviderKind,
} from "@novel/core";
import { inferDefaultModelApi } from "@novel/core";
import { useEffect, useState, type FormEvent } from "react";
import type { ApplicationConfigurationClient } from "./ApplicationConfigurationClient.js";

export interface PersistentModelConnectionSettingsPanelProps {
  readonly configuration: ApplicationConfigurationClient;
}

interface ModelConnectionDraft {
  readonly connectionId?: string;
  readonly modelProfileId?: string;
  readonly credentialRef?: string;
  readonly credentialConfigured: boolean;
  readonly displayName: string;
  readonly providerKind: ProviderKind;
  readonly api: ModelApi;
  readonly modelId: string;
  readonly baseUrl: string;
  readonly apiKey: string;
}

const PROVIDER_OPTIONS: readonly {
  readonly value: ProviderKind;
  readonly label: string;
}[] = Object.freeze([
  Object.freeze({ value: "openai", label: "OpenAI" }),
  Object.freeze({ value: "anthropic", label: "Anthropic" }),
  Object.freeze({ value: "google", label: "Google" }),
  Object.freeze({ value: "openrouter", label: "OpenRouter" }),
  Object.freeze({ value: "openai_compatible", label: "OpenAI Compatible" }),
  Object.freeze({ value: "custom", label: "自定义" }),
]);

const API_OPTIONS: readonly {
  readonly value: ModelApi;
  readonly label: string;
}[] = Object.freeze([
  Object.freeze({ value: "openai-responses", label: "OpenAI Responses" }),
  Object.freeze({ value: "openai-completions", label: "OpenAI Chat Completions" }),
  Object.freeze({ value: "anthropic-messages", label: "Anthropic Messages" }),
  Object.freeze({ value: "google-generative-ai", label: "Google Generative AI" }),
  Object.freeze({ value: "google-vertex", label: "Google Vertex" }),
  Object.freeze({ value: "azure-openai-responses", label: "Azure OpenAI Responses" }),
  Object.freeze({ value: "openai-codex-responses", label: "OpenAI Codex Responses" }),
  Object.freeze({ value: "bedrock-converse-stream", label: "Amazon Bedrock Converse" }),
  Object.freeze({ value: "mistral-conversations", label: "Mistral Conversations" }),
  Object.freeze({ value: "pi-messages", label: "Pi Messages" }),
]);

const NEW_CONNECTION_DRAFT: ModelConnectionDraft = Object.freeze({
  credentialConfigured: false,
  displayName: "OpenAI 主力模型",
  providerKind: "openai",
  api: "openai-responses",
  modelId: "gpt-5",
  baseUrl: "",
  apiKey: "",
});

export function PersistentModelConnectionSettingsPanel({
  configuration,
}: PersistentModelConnectionSettingsPanelProps) {
  const [snapshot, setSnapshot] = useState<ApplicationConfigurationSnapshot>();
  const [draft, setDraft] = useState<ModelConnectionDraft>();
  const [status, setStatus] = useState("正在读取配置…");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setStatus("正在读取配置…");
    void configuration.load().then(
      (loaded) => {
        if (!active) return;
        setSnapshot(loaded);
        setStatus("配置已加载");
      },
      (error: unknown) => {
        if (!active) return;
        setStatus(`读取失败：${getErrorCode(error)}`);
      },
    );
    return () => {
      active = false;
    };
  }, [configuration]);

  const entries = snapshot === undefined ? [] : createEntries(snapshot);

  async function saveConnection(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (snapshot === undefined || draft === undefined || !isDraftValid(draft)) {
      return;
    }
    setSaving(true);
    setStatus("正在保存模型连接…");
    const connectionId = draft.connectionId ?? `connection:${crypto.randomUUID()}`;
    const modelProfileId =
      draft.modelProfileId ?? `model-profile:${crypto.randomUUID()}`;
    const credentialRef =
      draft.credentialRef ?? `credential:model-connection:${connectionId}`;
    const existingConnection = snapshot.modelConnections.find(
      (connection) => connection.id === connectionId,
    );
    const existingProfile = snapshot.modelProfiles.find(
      (profile) => profile.id === modelProfileId,
    );
    const connection: ModelConnectionSnapshot = Object.freeze({
      id: connectionId,
      displayName: draft.displayName.trim(),
      providerKind: draft.providerKind,
      ...(requiresBaseUrl(draft.providerKind)
        ? { baseUrl: draft.baseUrl.trim() }
        : {}),
      ...(existingConnection?.organizationId === undefined
        ? {}
        : { organizationId: existingConnection.organizationId }),
      ...(existingConnection?.projectId === undefined
        ? {}
        : { projectId: existingConnection.projectId }),
      ...(existingConnection?.apiVersion === undefined
        ? {}
        : { apiVersion: existingConnection.apiVersion }),
      ...(existingConnection?.region === undefined
        ? {}
        : { region: existingConnection.region }),
      enabled: true,
      credentialRef,
      credentialConfigured: false,
      publicHeaders: existingConnection?.publicHeaders ?? Object.freeze({}),
      secretHeaderCredentialRefs:
        existingConnection?.secretHeaderCredentialRefs ?? Object.freeze({}),
    });
    const modelProfile: ModelProfileSnapshot = Object.freeze({
      id: modelProfileId,
      displayName: `${draft.displayName.trim()} · ${draft.modelId.trim()}`,
      connectionId,
      api: draft.api,
      modelId: draft.modelId.trim(),
      parameters:
        existingProfile?.parameters ??
        Object.freeze({
          reasoningEffort: "medium",
          stopSequences: Object.freeze([]),
          providerOptions: Object.freeze({}),
        }),
      capabilityOverrides:
        existingProfile?.capabilityOverrides ?? Object.freeze({ toolCalling: true }),
      fallbackProfileIds:
        existingProfile?.fallbackProfileIds ?? Object.freeze([]),
    });

    try {
      const savedConfiguration = await configuration.save({
        ...snapshot,
        revision: snapshot.revision + 1,
        modelConnections: replaceOrAppend(
          snapshot.modelConnections,
          connection,
        ),
        modelProfiles: replaceOrAppend(snapshot.modelProfiles, modelProfile),
        defaultModelProfileId: modelProfileId,
      });
      setSnapshot(savedConfiguration);
      if (draft.apiKey.length > 0) {
        await configuration.saveCredential(credentialRef, draft.apiKey);
        setDraft({ ...draft, apiKey: "", credentialConfigured: true });
      }
      const refreshed = await configuration.load();
      setSnapshot(refreshed);
      setDraft(undefined);
      setStatus("模型连接保存成功，并已设为默认模型");
    } catch (error) {
      setStatus(`保存失败：${getErrorCode(error)}`);
    } finally {
      setSaving(false);
    }
  }

  async function setDefaultModel(modelProfileId: string): Promise<void> {
    if (snapshot === undefined || saving) return;
    setSaving(true);
    setStatus("正在更新默认模型…");
    try {
      const saved = await configuration.save({
        ...snapshot,
        revision: snapshot.revision + 1,
        defaultModelProfileId: modelProfileId,
      });
      setSnapshot(saved);
      setStatus("默认模型已更新");
    } catch (error) {
      setStatus(`默认模型更新失败：${getErrorCode(error)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="novel-model-settings" aria-label="模型设置">
      <header className="novel-model-settings-header">
        <div>
          <span>Models</span>
          <h3>模型连接</h3>
          <p>模型配置持久化到 Config；API Key 由 Host 凭据存储保存。</p>
        </div>
        <button
          disabled={snapshot === undefined || saving}
          onClick={() => setDraft(NEW_CONNECTION_DRAFT)}
          type="button"
        >
          新增模型连接
        </button>
      </header>

      <label className="novel-active-provider-field">
        <span>默认模型</span>
        <select
          aria-label="默认模型"
          disabled={snapshot === undefined || entries.length === 0 || saving}
          onChange={(event) => void setDefaultModel(event.currentTarget.value)}
          value={snapshot?.defaultModelProfileId ?? ""}
        >
          {entries.length === 0 ? <option value="">尚未配置</option> : null}
          {entries.map(({ profile }) => (
            <option key={profile.id} value={profile.id}>
              {profile.displayName}
            </option>
          ))}
        </select>
      </label>

      <div className="novel-provider-list" aria-label="模型连接列表">
        {entries.length === 0 ? (
          <div className="novel-provider-empty">
            <strong>还没有模型连接</strong>
            <span>新增连接后，模型与加密凭据会持久化保存。</span>
          </div>
        ) : (
          entries.map(({ connection, profile }) => (
            <article
              className="novel-provider-row"
              data-active={profile.id === snapshot?.defaultModelProfileId}
              key={profile.id}
            >
              <div>
                <strong>{connection.displayName}</strong>
                <span>
                  {providerLabel(connection.providerKind)} · {apiLabel(profile.api)} ·{" "}
                  {profile.modelId}
                </span>
                <small>
                  {connection.credentialConfigured
                    ? "API Key 已配置"
                    : "API Key 未配置"}
                </small>
              </div>
              {profile.id === snapshot?.defaultModelProfileId ? (
                <span className="novel-provider-active-badge">默认</span>
              ) : null}
              <button
                disabled={saving}
                onClick={() => setDraft(createDraft(connection, profile))}
                type="button"
              >
                编辑
              </button>
            </article>
          ))
        )}
      </div>

      {draft !== undefined ? (
        <form
          className="novel-provider-editor"
          onSubmit={(event) => void saveConnection(event)}
        >
          <header>
            <div>
              <span>{draft.connectionId === undefined ? "New" : "Edit"}</span>
              <h4>
                {draft.connectionId === undefined
                  ? "新增模型连接"
                  : "编辑模型连接"}
              </h4>
            </div>
            <button disabled={saving} onClick={() => setDraft(undefined)} type="button">
              取消
            </button>
          </header>
          <div className="novel-provider-fields">
            <label>
              <span>服务商</span>
              <select
                aria-label="服务商"
                disabled={saving}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    providerKind: event.currentTarget.value as ProviderKind,
                    api: inferDefaultModelApi(
                      event.currentTarget.value as ProviderKind,
                    ),
                  })
                }
                value={draft.providerKind}
              >
                {PROVIDER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>API 协议</span>
              <select
                aria-label="API 协议"
                disabled={saving}
                onChange={(event) =>
                  setDraft({ ...draft, api: event.currentTarget.value as ModelApi })
                }
                value={draft.api}
              >
                {isKnownApiOption(draft.api) ? null : (
                  <option value={draft.api}>{draft.api}</option>
                )}
                {API_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <ConnectionTextField
              disabled={saving}
              label="显示名称"
              onChange={(displayName) => setDraft({ ...draft, displayName })}
              placeholder="例如：OpenAI 主力模型"
              value={draft.displayName}
            />
            <ConnectionTextField
              disabled={saving}
              label="模型"
              onChange={(modelId) => setDraft({ ...draft, modelId })}
              placeholder="例如：gpt-5"
              value={draft.modelId}
            />
            {requiresBaseUrl(draft.providerKind) ? (
              <ConnectionTextField
                disabled={saving}
                label="Base URL"
                onChange={(baseUrl) => setDraft({ ...draft, baseUrl })}
                placeholder="https://api.example.com/v1"
                value={draft.baseUrl}
              />
            ) : null}
            <label>
              <span>API Key</span>
              <input
                aria-label="API Key"
                autoComplete="new-password"
                disabled={saving}
                onChange={(event) =>
                  setDraft({ ...draft, apiKey: event.currentTarget.value })
                }
                placeholder={
                  draft.credentialConfigured
                    ? "留空表示保持现有 API Key"
                    : "输入 API Key"
                }
                type="password"
                value={draft.apiKey}
              />
            </label>
          </div>
          <p className="novel-provider-security-note">
            API Key 不会写入 Application Configuration，也不会返回到界面。
          </p>
          <footer>
            <button disabled={saving || !isDraftValid(draft)} type="submit">
              {saving ? "保存中…" : "保存并设为默认模型"}
            </button>
          </footer>
        </form>
      ) : null}

      <p className="novel-provider-security-note" role="status">
        {status}
      </p>
    </section>
  );
}

function ConnectionTextField({
  label,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly placeholder: string;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        aria-label={label}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={placeholder}
        value={value}
      />
    </label>
  );
}

function createEntries(snapshot: ApplicationConfigurationSnapshot) {
  return snapshot.modelProfiles.flatMap((profile) => {
    const connection = snapshot.modelConnections.find(
      (candidate) => candidate.id === profile.connectionId,
    );
    return connection === undefined ? [] : [{ connection, profile }];
  });
}

function createDraft(
  connection: ModelConnectionSnapshot,
  profile: ModelProfileSnapshot,
): ModelConnectionDraft {
  return Object.freeze({
    connectionId: connection.id,
    modelProfileId: profile.id,
    credentialRef: connection.credentialRef,
    credentialConfigured: connection.credentialConfigured,
    displayName: connection.displayName,
    providerKind: connection.providerKind,
    api: profile.api ?? inferDefaultModelApi(connection.providerKind),
    modelId: profile.modelId,
    baseUrl: connection.baseUrl ?? "",
    apiKey: "",
  });
}

function replaceOrAppend<TValue extends { readonly id: string }>(
  values: readonly TValue[],
  value: TValue,
): readonly TValue[] {
  const index = values.findIndex((candidate) => candidate.id === value.id);
  if (index < 0) return Object.freeze([...values, value]);
  const next = [...values];
  next[index] = value;
  return Object.freeze(next);
}

function isDraftValid(draft: ModelConnectionDraft): boolean {
  return (
    draft.displayName.trim().length > 0 &&
    draft.api.trim().length > 0 &&
    draft.modelId.trim().length > 0 &&
    (!requiresBaseUrl(draft.providerKind) || draft.baseUrl.trim().length > 0) &&
    (draft.credentialConfigured || draft.apiKey.length > 0)
  );
}

function requiresBaseUrl(providerKind: ProviderKind): boolean {
  return providerKind === "openai_compatible" || providerKind === "custom";
}

function providerLabel(providerKind: ProviderKind): string {
  return (
    PROVIDER_OPTIONS.find((option) => option.value === providerKind)?.label ??
    providerKind
  );
}

function apiLabel(api: ModelApi | undefined): string {
  if (api === undefined) return "未指定协议";
  return API_OPTIONS.find((option) => option.value === api)?.label ?? api;
}

function isKnownApiOption(api: ModelApi): boolean {
  return API_OPTIONS.some((option) => option.value === api);
}

function getErrorCode(error: unknown): string {
  if (error === null || typeof error !== "object") return "UNKNOWN_ERROR";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : "UNKNOWN_ERROR";
}
