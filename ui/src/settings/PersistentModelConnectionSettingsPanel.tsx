/** Persists Model Profiles (provider/model/baseUrl/credential/capabilities) and the default model. */
import { useEffect, useState, type FormEvent } from "react";
import { Check, ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
// 运行时值必须走 browser-safe 的 /client 出口（根入口会拖入 zeromq 等 node 依赖 → renderer 白屏）
import { ModelInfoRegistry } from "@novel/core/client";
import type {
  ConfigSnapshot,
  ModelCapabilities,
  ModelProfile,
  ProviderType,
  ThinkingMode,
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
  readonly capsOpen: boolean;
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
  capsOpen: false,
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

const fmtTokens = (n: number | undefined, fallback: string): string =>
  n === undefined ? fallback : n.toLocaleString("en-US");

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
      setStatus("已保存并设为默认 · 对新对话生效");
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
      setStatus("已设为默认模型 · 对新对话生效");
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
      setStatus("已删除模型服务");
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
          <p>模型服务与能力覆盖；密钥由 Host 凭据存储加密保存。</p>
        </div>
      </header>

      <div className="novel-set-section">
        <b>模型服务</b>
        <small>密钥加密存储于本机</small>
      </div>

      <div aria-label="模型列表">
        {profiles.length === 0 ? (
          <div className="novel-provider-empty">
            <strong>还没有模型配置</strong>
            <span>新增后，模型与加密凭据会持久化保存。</span>
          </div>
        ) : (
          profiles.map((profile) => {
            const info = modelInfoRegistry.getModelInfo(profile.model);
            const overrides =
              profile.capabilities === undefined ? 0 : Object.keys(profile.capabilities).length;
            return (
              <article
                className="novel-prof-card"
                data-default={profile.id === snapshot?.defaultProfileId}
                key={profile.id}
              >
                <div className="novel-prof-head">
                  <b>{profile.label ?? profile.model}</b>
                  {profile.id === snapshot?.defaultProfileId ? (
                    <span className="novel-def-tag">默认</span>
                  ) : null}
                  {overrides > 0 ? <span className="novel-cap-tag">能力覆盖 {overrides} 项</span> : null}
                </div>
                <div className="novel-prof-meta">
                  {profile.provider === "anthropic" ? "Anthropic" : "OpenAI 兼容"} ·{" "}
                  <code>{profile.model}</code>
                  {profile.baseUrl ? ` · ${profile.baseUrl}` : ""}
                  <br />
                  识别 {fmtTokens(info.contextWindowTokens, "128,000（兜底）")} 窗口 ·{" "}
                  {info.thinkingMode}
                  {overrides > 0 ? "（部分被覆盖）" : ""} · 密钥
                  {snapshot?.credentials[profile.credentialRef] === "present" ? (
                    <span className="ok">已配置</span>
                  ) : (
                    <span className="miss">未配置</span>
                  )}
                </div>
                <div className="novel-prof-acts">
                  {profile.id !== snapshot?.defaultProfileId ? (
                    <button
                      className="novel-set-btn"
                      disabled={saving}
                      onClick={() => void setDefault(profile.id)}
                      type="button"
                    >
                      设为默认
                    </button>
                  ) : null}
                  <button
                    className="novel-set-btn"
                    disabled={saving}
                    onClick={() => setDraft(toDraft(profile))}
                    type="button"
                  >
                    <Pencil size={12} aria-hidden />
                    编辑
                  </button>
                  <button
                    className="novel-set-btn danger"
                    disabled={saving}
                    onClick={() => void remove(profile.id)}
                    type="button"
                  >
                    <Trash2 size={12} aria-hidden />
                    删除
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>

      {draft === undefined ? (
        <button
          className="novel-set-btn block"
          disabled={snapshot === undefined || saving}
          onClick={() => setDraft(NEW_DRAFT)}
          type="button"
        >
          <Plus size={12} aria-hidden />
          添加模型服务
        </button>
      ) : (
        <form className="novel-prof-card" onSubmit={(event) => void saveProfile(event)}>
          <div className="novel-set-section" style={{ marginTop: 0, borderBottom: 0, paddingBottom: 0 }}>
            <b>{draft.profileId === undefined ? "添加" : "编辑"}模型服务</b>
          </div>
          {(() => {
            const detected = modelInfoRegistry.getModelInfo(draft.model.trim() || "unknown-model");
            return (
              <>
                <div className="novel-set-field">
                  <label htmlFor="prof-provider">服务商</label>
                  <span className="novel-set-select-wrap">
                    <select
                      aria-label="服务商"
                      className="novel-set-select"
                      disabled={saving}
                      id="prof-provider"
                      onChange={(event) =>
                        setDraft({ ...draft, provider: event.currentTarget.value as ProviderType })
                      }
                      value={draft.provider}
                    >
                      <option value="openai">OpenAI 兼容</option>
                      <option value="anthropic">Anthropic</option>
                    </select>
                  </span>
                </div>
                <div className="novel-set-field">
                  <label htmlFor="prof-label">显示名称</label>
                  <input
                    aria-label="显示名称"
                    className="novel-set-input"
                    disabled={saving}
                    id="prof-label"
                    onChange={(event) => setDraft({ ...draft, label: event.currentTarget.value })}
                    placeholder="如 DeepSeek"
                    value={draft.label}
                  />
                </div>
                <div className="novel-set-field">
                  <label htmlFor="prof-model">模型 ID</label>
                  <input
                    aria-label="模型 ID"
                    className="novel-set-input"
                    disabled={saving}
                    id="prof-model"
                    onChange={(event) => setDraft({ ...draft, model: event.currentTarget.value })}
                    placeholder="如 deepseek-v4-flash"
                    value={draft.model}
                  />
                </div>
                <div className="novel-set-field">
                  <label />
                  <p className="novel-set-hint">
                    {draft.model.trim() === ""
                      ? "输入模型 ID 后按名称自动识别能力"
                      : `识别：${fmtTokens(detected.contextWindowTokens, "128,000")} 窗口 · ${detected.thinkingMode} · ${detected.supportsTemperature ? "支持温度" : "无温度"}`}
                  </p>
                </div>
                <div className="novel-set-field">
                  <label htmlFor="prof-base-url">Base URL</label>
                  <input
                    aria-label="Base URL"
                    className="novel-set-input"
                    disabled={saving}
                    id="prof-base-url"
                    onChange={(event) => setDraft({ ...draft, baseUrl: event.currentTarget.value })}
                    placeholder="可选 · 缺省用服务商官方地址"
                    value={draft.baseUrl}
                  />
                </div>
                <div className="novel-set-field">
                  <label htmlFor="prof-api-key">API 密钥</label>
                  <input
                    aria-label="API 密钥"
                    autoComplete="new-password"
                    className="novel-set-input"
                    disabled={saving}
                    id="prof-api-key"
                    onChange={(event) => setDraft({ ...draft, apiKey: event.currentTarget.value })}
                    placeholder={draft.profileId === undefined ? "sk-…" : "留空保持不变"}
                    type="password"
                    value={draft.apiKey}
                  />
                </div>
                <button
                  className="novel-cap-fold-head"
                  disabled={saving}
                  onClick={() => setDraft({ ...draft, capsOpen: !draft.capsOpen })}
                  type="button"
                >
                  {draft.capsOpen ? (
                    <ChevronDown size={13} aria-hidden />
                  ) : (
                    <ChevronRight size={13} aria-hidden />
                  )}
                  模型能力（高级）
                  <small>按模型名自动识别 · 可手动覆盖</small>
                </button>
                {draft.capsOpen ? (
                  <div className="novel-cap-fold-body">
                    <div className="novel-set-field">
                      <label htmlFor="prof-cap-max-out">最大输出</label>
                      <input
                        aria-label="最大输出 Tokens"
                        className="novel-set-input"
                        disabled={saving}
                        id="prof-cap-max-out"
                        inputMode="numeric"
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            capabilities: { ...draft.capabilities, maxOutputTokens: event.currentTarget.value },
                          })
                        }
                        placeholder={`自动识别 · ${fmtTokens(detected.maxOutputTokens, "8192")} tokens`}
                        value={draft.capabilities.maxOutputTokens}
                      />
                    </div>
                    <div className="novel-set-field">
                      <label htmlFor="prof-cap-ctx">上下文窗口</label>
                      <input
                        aria-label="上下文窗口 Tokens"
                        className="novel-set-input"
                        disabled={saving}
                        id="prof-cap-ctx"
                        inputMode="numeric"
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            capabilities: {
                              ...draft.capabilities,
                              contextWindowTokens: event.currentTarget.value,
                            },
                          })
                        }
                        placeholder={`自动识别 · ${fmtTokens(detected.contextWindowTokens, "128,000")} tokens`}
                        value={draft.capabilities.contextWindowTokens}
                      />
                    </div>
                    <div className="novel-set-field">
                      <label htmlFor="prof-cap-think">思考模式</label>
                      <span className="novel-set-select-wrap">
                        <select
                          aria-label="思考模式"
                          className="novel-set-select"
                          disabled={saving}
                          id="prof-cap-think"
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
                      </span>
                    </div>
                    <div className="novel-set-field">
                      <label htmlFor="prof-cap-temp">支持温度</label>
                      <span className="novel-set-select-wrap">
                        <select
                          aria-label="支持温度"
                          className="novel-set-select"
                          disabled={saving}
                          id="prof-cap-temp"
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
                          <option value="">
                            自动识别（{detected.supportsTemperature ? "支持" : "不支持"}）
                          </option>
                          <option value="yes">支持</option>
                          <option value="no">不支持</option>
                        </select>
                      </span>
                    </div>
                    <p className="novel-set-hint">
                      压缩触发线按上下文窗口计算；不支持温度的模型将忽略温度设置。
                    </p>
                  </div>
                ) : null}
                <div className="novel-save-bar">
                  <button className="novel-set-btn primary" disabled={saving || !isDraftValid(draft)} type="submit">
                    <Check size={12} aria-hidden />
                    {saving ? "保存中…" : "保存"}
                  </button>
                  <button className="novel-set-btn" disabled={saving} onClick={() => setDraft(undefined)} type="button">
                    取消
                  </button>
                </div>
              </>
            );
          })()}
        </form>
      )}

      <div className="novel-foot-hint">
        <Check size={12} aria-hidden />
        Agent 页的 Normal 档 = 此处默认服务，Fast 档在 Agent 页绑定 · 修改对新对话生效，运行中的对话维持原参数
      </div>

      <p className="novel-provider-security-note" role="status">
        {status}
      </p>
    </section>
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
    capsOpen: false,
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
