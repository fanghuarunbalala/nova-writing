/** Persists Model Profiles (provider/model/baseUrl/credential/capabilities) and the default model. */
import { useEffect, useState, type FormEvent } from "react";
import {
  ModelInfoRegistry,
  type ConfigSnapshot,
  type ModelCapabilities,
  type ModelProfile,
  type ProviderType,
  type ThinkingMode,
} from "@novel/core";
import type { ApplicationConfigurationClient } from "./ApplicationConfigurationClient.js";

export interface PersistentModelConnectionSettingsPanelProps {
  readonly configuration: ApplicationConfigurationClient;
}

/** 能力覆盖 draft（字符串态；空 = 自动识别） */
interface CapabilitiesDraft {
  readonly maxOutputTokens: string;
  readonly contextWindowTokens: string;
  readonly thinkingMode: "" | ThinkingMode;
  readonly supportsTemperature: "" | "yes" | "no";
}

interface ProfileDraft {
  readonly profileId?: string;
  readonly label: string;
  readonly provider: ProviderType;
  readonly model: string;
  readonly baseUrl: string;
  readonly credentialRef: string;
  readonly apiKey: string;
  readonly capabilities: CapabilitiesDraft;
}

const EMPTY_CAPS: CapabilitiesDraft = Object.freeze({
  maxOutputTokens: "",
  contextWindowTokens: "",
  thinkingMode: "",
  supportsTemperature: "",
});

const NEW_DRAFT: ProfileDraft = Object.freeze({
  label: "默认模型",
  provider: "openai",
  model: "deepseek-v4-flash",
  baseUrl: "",
  credentialRef: "default",
  apiKey: "",
  capabilities: EMPTY_CAPS,
});

/** 模型能力自动识别（纯启发式，无覆盖注册；占位/提示用） */
const modelInfoRegistry = new ModelInfoRegistry();
const THINK_MODES: readonly { value: ThinkingMode; label: string }[] = [
  { value: "adaptive-effort", label: "自适应思考 · adaptive-effort" },
  { value: "reasoning-effort", label: "推理力度 · reasoning-effort" },
  { value: "budget-tokens", label: "思考预算 · budget-tokens" },
  { value: "none", label: "不支持思考 · none" },
];

/** draft 能力字符串 → 契约能力对象（全部为空返回 undefined = 自动识别） */
function buildCapabilities(
  caps: CapabilitiesDraft,
): { ok: true; capabilities?: ModelCapabilities } | { ok: false; error: string } {
  const out: ModelCapabilities = {};
  if (caps.maxOutputTokens.trim() !== "") {
    const n = Number(caps.maxOutputTokens);
    if (!Number.isInteger(n) || n <= 0) return { ok: false, error: "最大输出需为正整数" };
    out.maxOutputTokens = n;
  }
  if (caps.contextWindowTokens.trim() !== "") {
    const n = Number(caps.contextWindowTokens);
    if (!Number.isInteger(n) || n <= 0) return { ok: false, error: "上下文窗口需为正整数" };
    out.contextWindowTokens = n;
  }
  if (caps.thinkingMode !== "") out.thinkingMode = caps.thinkingMode;
  if (caps.supportsTemperature !== "") out.supportsTemperature = caps.supportsTemperature === "yes";
  return { ok: true, ...(Object.keys(out).length > 0 ? { capabilities: out } : {}) };
}

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
    const caps = buildCapabilities(draft.capabilities);
    if (!caps.ok) {
      setStatus(caps.error);
      return;
    }
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
          ...(caps.capabilities !== undefined ? { capabilities: caps.capabilities } : {}),
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
                {profile.capabilities !== undefined ? (
                  <small>
                    能力覆盖 {Object.keys(profile.capabilities).length} 项 · 识别{" "}
                    {modelInfoRegistry.getModelInfo(profile.model).contextWindowTokens ?? "?"} 窗口
                  </small>
                ) : null}
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
          {(() => {
            const detected = modelInfoRegistry.getModelInfo(draft.model.trim() || "unknown-model");
            return (
              <div className="novel-provider-capabilities">
                <div className="novel-cap-title">模型能力（高级 · 按模型名自动识别，可覆盖）</div>
                <div className="novel-provider-fields">
                  <TextField
                    disabled={saving}
                    label="最大输出 Tokens"
                    onChange={(maxOutputTokens) =>
                      setDraft({ ...draft, capabilities: { ...draft.capabilities, maxOutputTokens } })
                    }
                    placeholder={`自动识别 · ${detected.maxOutputTokens ?? "8192（默认）"}`}
                    value={draft.capabilities.maxOutputTokens}
                  />
                  <TextField
                    disabled={saving}
                    label="上下文窗口 Tokens"
                    onChange={(contextWindowTokens) =>
                      setDraft({ ...draft, capabilities: { ...draft.capabilities, contextWindowTokens } })
                    }
                    placeholder={`自动识别 · ${detected.contextWindowTokens ?? "128000（兜底）"}`}
                    value={draft.capabilities.contextWindowTokens}
                  />
                  <label>
                    <span>思考模式</span>
                    <select
                      aria-label="思考模式"
                      disabled={saving}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          capabilities: {
                            ...draft.capabilities,
                            thinkingMode: event.currentTarget.value as CapabilitiesDraft["thinkingMode"],
                          },
                        })
                      }
                      value={draft.capabilities.thinkingMode}
                    >
                      <option value="">自动识别（{detected.thinkingMode}）</option>
                      {THINK_MODES.map((mode) => (
                        <option key={mode.value} value={mode.value}>
                          {mode.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>支持温度</span>
                    <select
                      aria-label="支持温度"
                      disabled={saving}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          capabilities: {
                            ...draft.capabilities,
                            supportsTemperature: event.currentTarget.value as CapabilitiesDraft["supportsTemperature"],
                          },
                        })
                      }
                      value={draft.capabilities.supportsTemperature}
                    >
                      <option value="">自动识别（{detected.supportsTemperature ? "支持" : "不支持"}）</option>
                      <option value="yes">支持</option>
                      <option value="no">不支持</option>
                    </select>
                  </label>
                </div>
                <p className="novel-cap-hint">
                  压缩触发线按上下文窗口计算；不支持温度的模型将忽略温度设置。
                </p>
              </div>
            );
          })()}
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
  placeholder,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly disabled: boolean;
  readonly placeholder?: string;
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

function toDraft(profile: ModelProfile): ProfileDraft {
  const caps = profile.capabilities;
  return Object.freeze({
    profileId: profile.id,
    label: profile.label ?? "",
    provider: profile.provider,
    model: profile.model,
    baseUrl: profile.baseUrl ?? "",
    credentialRef: profile.credentialRef,
    apiKey: "",
    capabilities: Object.freeze({
      maxOutputTokens: caps?.maxOutputTokens !== undefined ? String(caps.maxOutputTokens) : "",
      contextWindowTokens:
        caps?.contextWindowTokens !== undefined ? String(caps.contextWindowTokens) : "",
      thinkingMode: caps?.thinkingMode ?? "",
      supportsTemperature:
        caps?.supportsTemperature === undefined ? "" : caps.supportsTemperature ? "yes" : "no",
    }),
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
