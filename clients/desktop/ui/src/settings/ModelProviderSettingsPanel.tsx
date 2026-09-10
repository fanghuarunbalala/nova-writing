/** Adds, edits, and selects non-secret model Provider settings. */
import { useState, useSyncExternalStore, type FormEvent } from "react";
import type { ApplicationSettingsStore } from "./ApplicationSettingsStore.js";
import type {
  ModelProviderSettings,
  ModelProviderSettingsInput,
} from "./ModelProviderSettings.js";
import type { ApplicationConfigurationClient } from "./ApplicationConfigurationClient.js";
import { PersistentModelConnectionSettingsPanel } from "./PersistentModelConnectionSettingsPanel.js";

export interface ModelProviderSettingsPanelProps {
  readonly store: ApplicationSettingsStore;
  readonly configuration?: ApplicationConfigurationClient;
}

interface ProviderDraft {
  readonly id?: string;
  readonly name: string;
  readonly providerId: string;
  readonly api: string;
  readonly modelId: string;
  readonly baseUrl: string;
}

const NEW_PROVIDER_DRAFT: ProviderDraft = Object.freeze({
  name: "",
  providerId: "",
  api: "openai-responses",
  modelId: "",
  baseUrl: "",
});

const API_OPTIONS = Object.freeze([
  Object.freeze({ value: "openai-responses", label: "OpenAI Responses" }),
  Object.freeze({ value: "openai-completions", label: "OpenAI Compatible" }),
  Object.freeze({ value: "anthropic-messages", label: "Anthropic Messages" }),
  Object.freeze({ value: "google-generative-ai", label: "Google Generative AI" }),
]);

export function ModelProviderSettingsPanel({
  store,
  configuration,
}: ModelProviderSettingsPanelProps) {
  return configuration === undefined ? (
    <LocalModelProviderSettingsPanel store={store} />
  ) : (
    <PersistentModelConnectionSettingsPanel configuration={configuration} />
  );
}

function LocalModelProviderSettingsPanel({
  store,
}: Pick<ModelProviderSettingsPanelProps, "store">) {
  const snapshot = useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getSnapshot(),
    () => store.getSnapshot(),
  );
  const [draft, setDraft] = useState<ProviderDraft>();
  const activeProvider = snapshot.modelProviders.find(
    (provider) => provider.id === snapshot.activeModelProviderId,
  );
  const saveProvider = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (draft === undefined || !isDraftValid(draft)) return;
    const input: ModelProviderSettingsInput = {
      name: draft.name,
      providerId: draft.providerId,
      api: draft.api,
      modelId: draft.modelId,
      ...(draft.baseUrl.trim().length === 0 ? {} : { baseUrl: draft.baseUrl }),
    };
    if (draft.id === undefined) store.addModelProvider(input);
    else store.updateModelProvider(draft.id, input);
    setDraft(undefined);
  };
  return (
    <section className="novel-model-settings" aria-label="模型设置">
      <header className="novel-model-settings-header">
        <div>
          <span>Models</span>
          <h3>模型与 Provider</h3>
          <p>管理模型连接信息，并选择当前会话默认使用的 Provider。</p>
        </div>
        <button onClick={() => setDraft(NEW_PROVIDER_DRAFT)} type="button">
          新增 Provider
        </button>
      </header>

      <label className="novel-active-provider-field">
        <span>当前生效 Provider</span>
        <select
          aria-label="当前生效 Provider"
          disabled={snapshot.modelProviders.length === 0}
          onChange={(event) => store.setActiveModelProvider(event.currentTarget.value)}
          value={snapshot.activeModelProviderId ?? ""}
        >
          {snapshot.modelProviders.length === 0 ? (
            <option value="">尚未配置</option>
          ) : null}
          {snapshot.modelProviders.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name} · {provider.modelId}
            </option>
          ))}
        </select>
      </label>

      <div className="novel-provider-list" aria-label="Provider 列表">
        {snapshot.modelProviders.length === 0 ? (
          <div className="novel-provider-empty">
            <strong>还没有 Provider</strong>
            <span>新增一个 Provider 后即可选择当前生效模型。</span>
          </div>
        ) : (
          snapshot.modelProviders.map((provider) => (
            <ProviderRow
              active={provider.id === activeProvider?.id}
              key={provider.id}
              onEdit={() => setDraft(createDraft(provider))}
              provider={provider}
            />
          ))
        )}
      </div>

      {draft !== undefined ? (
        <form className="novel-provider-editor" onSubmit={saveProvider}>
          <header>
            <div>
              <span>{draft.id === undefined ? "New Provider" : "Edit Provider"}</span>
              <h4>{draft.id === undefined ? "新增 Provider" : "编辑 Provider"}</h4>
            </div>
            <button onClick={() => setDraft(undefined)} type="button">
              取消
            </button>
          </header>
          <div className="novel-provider-fields">
            <ProviderTextField
              label="名称"
              onChange={(name) => setDraft({ ...draft, name })}
              placeholder="例如：主力模型"
              value={draft.name}
            />
            <ProviderTextField
              label="Provider ID"
              onChange={(providerId) => setDraft({ ...draft, providerId })}
              placeholder="例如：openai"
              value={draft.providerId}
            />
            <label>
              <span>API 协议</span>
              <select
                aria-label="API 协议"
                onChange={(event) => setDraft({ ...draft, api: event.currentTarget.value })}
                value={draft.api}
              >
                {API_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <ProviderTextField
              label="模型 ID"
              onChange={(modelId) => setDraft({ ...draft, modelId })}
              placeholder="例如：gpt-5"
              value={draft.modelId}
            />
            <ProviderTextField
              label="Base URL"
              onChange={(baseUrl) => setDraft({ ...draft, baseUrl })}
              placeholder="可选，由 Provider 使用默认地址"
              value={draft.baseUrl}
            />
          </div>
          <div className="novel-provider-security-note">
            API Key 不进入共享 UI 状态，后续由桌面或服务端 Host 的安全凭据存储管理。
          </div>
          <footer>
            <button disabled={!isDraftValid(draft)} type="submit">
              保存 Provider
            </button>
          </footer>
        </form>
      ) : null}
    </section>
  );
}

function ProviderRow({
  provider,
  active,
  onEdit,
}: {
  readonly provider: ModelProviderSettings;
  readonly active: boolean;
  readonly onEdit: () => void;
}) {
  return (
    <article className="novel-provider-row" data-active={active}>
      <div>
        <strong>{provider.name}</strong>
        <span>
          {provider.providerId} · {provider.modelId}
        </span>
        <small>{provider.baseUrl ?? "使用 Provider 默认地址"}</small>
      </div>
      {active ? <span className="novel-provider-active-badge">当前生效</span> : null}
      <button onClick={onEdit} type="button">
        编辑
      </button>
    </article>
  );
}

function ProviderTextField({
  label,
  placeholder,
  value,
  onChange,
}: {
  readonly label: string;
  readonly placeholder: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        aria-label={label}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={placeholder}
        value={value}
      />
    </label>
  );
}

function createDraft(provider: ModelProviderSettings): ProviderDraft {
  return {
    id: provider.id,
    name: provider.name,
    providerId: provider.providerId,
    api: provider.api,
    modelId: provider.modelId,
    baseUrl: provider.baseUrl ?? "",
  };
}

function isDraftValid(draft: ProviderDraft): boolean {
  return (
    draft.name.trim().length > 0 &&
    draft.providerId.trim().length > 0 &&
    draft.api.trim().length > 0 &&
    draft.modelId.trim().length > 0
  );
}
