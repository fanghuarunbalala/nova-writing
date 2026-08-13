/** Persists Model Profiles (provider/model/baseUrl/credential) and the default model. */
import { useEffect, useState, type FormEvent } from "react";
import type { ConfigSnapshot, ModelProfile, ProviderType } from "@novel/core";
import type { ApplicationConfigurationClient } from "./ApplicationConfigurationClient.js";

export interface PersistentModelConnectionSettingsPanelProps {
  readonly configuration: ApplicationConfigurationClient;
}

interface ProfileDraft {
  readonly profileId?: string;
  readonly label: string;
  readonly provider: ProviderType;
  readonly model: string;
  readonly baseUrl: string;
  readonly credentialRef: string;
  readonly apiKey: string;
}

const NEW_DRAFT: ProfileDraft = Object.freeze({
  label: "默认模型",
  provider: "openai",
  model: "deepseek-v4-flash",
  baseUrl: "",
  credentialRef: "default",
  apiKey: "",
});

export function PersistentModelConnectionSettingsPanel({
  configuration,
}: PersistentModelConnectionSettingsPanelProps) {
  const [snapshot, setSnapshot] = useState<ConfigSnapshot>();
  const [draft, setDraft] = useState<ProfileDraft>();
  const [status, setStatus] = useState("正在读取配置…");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
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

  async function saveProfile(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (draft === undefined || !isDraftValid(draft)) return;
    setSaving(true);
    setStatus("正在保存…");
    const profileId = draft.profileId ?? `profile_${Date.now()}`;
    try {
      await configuration.mutate({
        op: "model.upsert",
        profileId,
        profile: {
          provider: draft.provider,
          model: draft.model.trim(),
          ...(draft.baseUrl.trim() === "" ? {} : { baseUrl: draft.baseUrl.trim() }),
          credentialRef: draft.credentialRef,
          label: draft.label.trim(),
        },
      });
      if (draft.apiKey.length > 0) {
        await configuration.mutate({ op: "credential.save", ref: draft.credentialRef, secret: draft.apiKey });
      }
      await configuration.mutate({ op: "model.setDefault", profileId });
      setDraft(undefined);
      setSnapshot(await configuration.load());
      setStatus("已保存并设为默认");
    } catch (error) {
      setStatus(`保存失败：${getErrorCode(error)}`);
    } finally {
      setSaving(false);
    }
  }

  async function setDefault(profileId: string): Promise<void> {
    setSaving(true);
    try {
      await configuration.mutate({ op: "model.setDefault", profileId });
      setSnapshot(await configuration.load());
      setStatus("默认模型已更新");
    } catch (error) {
      setStatus(`更新失败：${getErrorCode(error)}`);
    } finally {
      setSaving(false);
    }
  }

  async function remove(profileId: string): Promise<void> {
    setSaving(true);
    try {
      await configuration.mutate({ op: "model.remove", profileId });
      setSnapshot(await configuration.load());
      setStatus("已删除");
    } catch (error) {
      setStatus(`删除失败：${getErrorCode(error)}`);
    } finally {
      setSaving(false);
    }
  }

  const profiles = snapshot?.profiles ?? [];

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
          onClick={() => setDraft(NEW_DRAFT)}
          type="button"
        >
          新增模型
        </button>
      </header>

      <div className="novel-provider-list" aria-label="模型列表">
        {profiles.length === 0 ? (
          <div className="novel-provider-empty">
            <strong>还没有模型配置</strong>
            <span>新增后，模型与加密凭据会持久化保存。</span>
          </div>
        ) : (
          profiles.map((profile) => (
            <article
              className="novel-provider-row"
              data-active={profile.id === snapshot?.defaultProfileId}
              key={profile.id}
            >
              <div>
                <strong>{profile.label ?? profile.model}</strong>
                <span>
                  {profile.provider} · {profile.model}
                </span>
                <small>
                  {snapshot?.credentials[profile.credentialRef] === "present"
                    ? "API Key 已配置"
                    : "API Key 未配置"}
                </small>
              </div>
              {profile.id === snapshot?.defaultProfileId ? (
                <span className="novel-provider-active-badge">默认</span>
              ) : null}
              <button
                disabled={saving || profile.id === snapshot?.defaultProfileId}
                onClick={() => void setDefault(profile.id)}
                type="button"
              >
                设为默认
              </button>
              <button
                disabled={saving}
                onClick={() => setDraft(toDraft(profile))}
                type="button"
              >
                编辑
              </button>
              <button disabled={saving} onClick={() => void remove(profile.id)} type="button">
                删除
              </button>
            </article>
          ))
        )}
      </div>

      {draft !== undefined ? (
        <form className="novel-provider-editor" onSubmit={(event) => void saveProfile(event)}>
          <header>
            <h4>{draft.profileId === undefined ? "新增模型" : "编辑模型"}</h4>
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
                  setDraft({ ...draft, provider: event.currentTarget.value as ProviderType })
                }
                value={draft.provider}
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
              </select>
            </label>
            <TextField disabled={saving} label="显示名称" onChange={(label) => setDraft({ ...draft, label })} value={draft.label} />
            <TextField disabled={saving} label="模型" onChange={(model) => setDraft({ ...draft, model })} value={draft.model} />
            <TextField disabled={saving} label="Base URL（可空）" onChange={(baseUrl) => setDraft({ ...draft, baseUrl })} value={draft.baseUrl} />
            <label>
              <span>API Key</span>
              <input
                aria-label="API Key"
                autoComplete="new-password"
                disabled={saving}
                onChange={(event) => setDraft({ ...draft, apiKey: event.currentTarget.value })}
                placeholder="留空表示保持现有 API Key"
                type="password"
                value={draft.apiKey}
              />
            </label>
          </div>
          <footer>
            <button disabled={saving || !isDraftValid(draft)} type="submit">
              {saving ? "保存中…" : "保存并设为默认"}
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

function TextField({
  label,
  value,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
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
        value={value}
      />
    </label>
  );
}

function toDraft(profile: ModelProfile): ProfileDraft {
  return Object.freeze({
    profileId: profile.id,
    label: profile.label ?? "",
    provider: profile.provider,
    model: profile.model,
    baseUrl: profile.baseUrl ?? "",
    credentialRef: profile.credentialRef,
    apiKey: "",
  });
}

function isDraftValid(draft: ProfileDraft): boolean {
  return draft.model.trim().length > 0 && draft.credentialRef.trim().length > 0;
}

function getErrorCode(error: unknown): string {
  if (error === null || typeof error !== "object") return "UNKNOWN_ERROR";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : "UNKNOWN_ERROR";
}
