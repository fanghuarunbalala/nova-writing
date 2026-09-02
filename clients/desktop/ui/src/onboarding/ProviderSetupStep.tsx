/**
 * ProviderSetupStep
 *
 * 引导向导第 2 步：预设快捷卡（DeepSeek / Claude / OpenAI / 自定义 OpenAI 兼容）
 * + API 密钥 / 模型 ID / Base URL 表单 + 测试连接 + 保存并设为默认。
 * 保存链路与 PersistentModelConnectionSettingsPanel 一致
 * （model.upsert → credential.save → model.setDefault）；
 * 快照已有可用配置时展示状态卡，可直接跳到下一步。
 */
import { useEffect, useState } from "react";
import { Check, PlugZap } from "lucide-react";
// 运行时值必须走 browser-safe 的 /client 出口（根入口会拖入 zeromq 等 node 依赖 → renderer 白屏）
import { ModelInfoRegistry } from "@novel/core/client";
import type { ConfigSnapshot, ConnectionTestResult, ProviderType } from "@novel/core";
import type { ApplicationConfigurationClient } from "../settings/ApplicationConfigurationClient.js";
import styles from "./OnboardingWizard.module.css";

const modelInfoRegistry = new ModelInfoRegistry();

interface ProviderPreset {
  readonly id: string;
  readonly label: string;
  readonly note: string;
  readonly provider: ProviderType;
  readonly model: string;
  readonly baseUrl: string;
  readonly keyHint: string;
}

const PRESETS: readonly ProviderPreset[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    note: "推荐 · 国内直连",
    provider: "openai",
    model: "deepseek-v4-flash",
    baseUrl: "https://api.deepseek.com/v1",
    keyHint: "密钥获取：platform.deepseek.com",
  },
  {
    id: "qwen",
    label: "通义千问 Qwen",
    note: "阿里云百炼 · 国内直连",
    provider: "openai",
    model: "qwen-max",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    keyHint: "密钥获取：bailian.console.aliyun.com",
  },
  {
    id: "kimi",
    label: "Kimi",
    note: "月之暗面 Moonshot · 国内直连",
    provider: "openai",
    model: "kimi-k2-0905-preview",
    baseUrl: "https://api.moonshot.cn/v1",
    keyHint: "密钥获取：platform.moonshot.cn",
  },
  {
    id: "openai",
    label: "OpenAI",
    note: "官方 API",
    provider: "openai",
    model: "gpt-5",
    baseUrl: "",
    keyHint: "密钥获取：platform.openai.com",
  },
  {
    id: "anthropic",
    label: "Anthropic Claude",
    note: "官方 API",
    provider: "anthropic",
    model: "claude-sonnet-5",
    baseUrl: "",
    keyHint: "密钥获取：console.anthropic.com",
  },
  {
    id: "custom",
    label: "其他 OpenAI 兼容",
    note: "硅基流动 / Ollama / vLLM 等",
    provider: "openai",
    model: "",
    baseUrl: "",
    keyHint: "填写对应服务商的 API 密钥",
  },
];

export interface ProviderSetupStepProps {
  readonly configuration?: ApplicationConfigurationClient;
  readonly onDone: () => void;
}

export function ProviderSetupStep({ configuration, onDone }: ProviderSetupStepProps) {
  const [presetId, setPresetId] = useState("deepseek");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(PRESETS[0]!.model);
  const [baseUrl, setBaseUrl] = useState(PRESETS[0]!.baseUrl);
  const [configured, setConfigured] = useState<ConfigSnapshot | undefined>(undefined);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  const preset = PRESETS.find((item) => item.id === presetId) ?? PRESETS[0]!;

  useEffect(() => {
    if (configuration === undefined) return;
    let active = true;
    void configuration.load().then(
      (snapshot) => {
        if (active) setConfigured(snapshot);
      },
      () => {
        // 读取失败：不展示状态卡，表单照常可用
      },
    );
    return () => {
      active = false;
    };
  }, [configuration]);

  const existing = (() => {
    if (configured === undefined) return undefined;
    const profile =
      configured.profiles.find((item) => item.id === configured.defaultProfileId) ??
      configured.profiles[0];
    if (profile === undefined) return undefined;
    return { profile, credentialReady: configured.credentials[profile.credentialRef] === "present" };
  })();

  const draftValid =
    model.trim().length > 0 &&
    apiKey.trim().length > 0 &&
    (preset.id !== "custom" || baseUrl.trim().length > 0);

  function selectPreset(id: string): void {
    const next = PRESETS.find((item) => item.id === id);
    if (next === undefined) return;
    setPresetId(id);
    setModel(next.model);
    setBaseUrl(next.baseUrl);
    setTestResult(undefined);
  }

  async function runTest(): Promise<void> {
    if (configuration?.test === undefined || !draftValid) return;
    setTesting(true);
    setTestResult(undefined);
    try {
      const result = await configuration.test({
        provider: preset.provider,
        ...(baseUrl.trim() === "" ? {} : { baseUrl: baseUrl.trim() }),
        apiKey: apiKey.trim(),
      });
      setTestResult(result);
    } catch {
      setTestResult({ ok: false, error: "测试请求失败（无法连接配置服务）" });
    } finally {
      setTesting(false);
    }
  }

  async function save(): Promise<void> {
    if (configuration === undefined || !draftValid) return;
    setSaving(true);
    setStatus("正在保存…");
    try {
      await configuration.mutate({
        op: "model.upsert",
        profileId: "onboarding_default",
        profile: {
          provider: preset.provider,
          model: model.trim(),
          ...(baseUrl.trim() === "" ? {} : { baseUrl: baseUrl.trim() }),
          credentialRef: "default",
          // 自定义预设没有有意义的厂商名——显示名落为模型 ID，避免出现"其他 OpenAI 兼容"这种标签
          label: preset.id === "custom" ? (model.trim() || "自定义模型") : preset.label,
        },
      });
      await configuration.mutate({
        op: "credential.save",
        ref: "default",
        secret: apiKey.trim(),
      });
      await configuration.mutate({ op: "model.setDefault", profileId: "onboarding_default" });
      onDone();
    } catch (error) {
      setStatus(`保存失败：${getErrorCode(error)}`);
    } finally {
      setSaving(false);
    }
  }

  if (configuration === undefined) {
    return (
      <div className={styles.stepBody}>
        <div className={styles.noticeCard}>
          当前宿主未提供持久化配置——模型服务请在桌面端「设置 → 模型」中配置后再开始创作。
        </div>
      </div>
    );
  }

  const detected = modelInfoRegistry.getModelInfo(model.trim() || "unknown-model");
  return (
    <div className={styles.stepBody}>
      {existing !== undefined ? (
        <div className={styles.configuredCard} data-ready={existing.credentialReady}>
          <strong>{existing.credentialReady ? "已配置模型服务" : "默认模型服务缺少密钥"}</strong>
          <span>
            {existing.profile.label ?? existing.profile.model} ·{" "}
            {existing.profile.provider === "anthropic" ? "Anthropic" : "OpenAI 兼容"} ·{" "}
            <code>{existing.profile.model}</code> ·{" "}
            {existing.profile.baseUrl ? `${existing.profile.baseUrl} · ` : ""}密钥
            {existing.credentialReady ? "已配置" : "未配置"}
          </span>
          <small>可直接进入下一步；在下方重新配置将保存为新的默认模型服务。</small>
        </div>
      ) : null}
      <div className={styles.presetGrid} role="radiogroup" aria-label="模型服务预设">
        {PRESETS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={styles.presetCard}
            role="radio"
            aria-checked={item.id === presetId}
            data-selected={item.id === presetId}
            disabled={saving}
            onClick={() => selectPreset(item.id)}
          >
            <strong>{item.label}</strong>
            <span>{item.note}</span>
          </button>
        ))}
      </div>
      <div className="novel-set-field">
        <label htmlFor="onb-api-key">API 密钥</label>
        <input
          aria-label="API 密钥"
          autoComplete="new-password"
          className="novel-set-input"
          disabled={saving}
          id="onb-api-key"
          onChange={(event) => {
            setApiKey(event.currentTarget.value);
            setTestResult(undefined);
          }}
          placeholder="sk-…"
          type="password"
          value={apiKey}
        />
        <p className={`novel-set-hint ${styles.hint}`}>{preset.keyHint}</p>
      </div>
      <div className="novel-set-field">
        <label htmlFor="onb-model">模型 ID</label>
        <input
          aria-label="模型 ID"
          className="novel-set-input"
          disabled={saving}
          id="onb-model"
          onChange={(event) => setModel(event.currentTarget.value)}
          placeholder="如 deepseek-v4-flash"
          value={model}
        />
        <p className={`novel-set-hint ${styles.hint}`}>
          {model.trim() === ""
            ? "输入模型 ID 后按名称自动识别能力"
            : `识别：${fmtTokens(detected.contextWindowTokens, "128,000")} 窗口 · ${detected.thinkingMode} · ${detected.supportsTemperature ? "支持温度" : "无温度"}`}
        </p>
      </div>
      <div className="novel-set-field">
        <label htmlFor="onb-base-url">Base URL</label>
        <input
          aria-label="Base URL"
          className="novel-set-input"
          disabled={saving}
          id="onb-base-url"
          onChange={(event) => setBaseUrl(event.currentTarget.value)}
          placeholder={
            preset.id === "custom"
              ? "必填 · 如 https://api.siliconflow.cn/v1"
              : "可选 · 缺省用服务商官方地址"
          }
          value={baseUrl}
        />
      </div>
      {configuration.test !== undefined ? (
        <div className={styles.testRow}>
          <button
            className="novel-set-btn"
            disabled={testing || saving || !draftValid}
            onClick={() => void runTest()}
            type="button"
          >
            <PlugZap size={12} aria-hidden />
            {testing ? "测试中…" : "测试连接"}
          </button>
          {testResult !== undefined ? (
            testResult.ok ? (
              <span className={styles.testOk}>
                <Check size={12} aria-hidden /> 连接正常
              </span>
            ) : (
              <span className={styles.testFail}>连接失败：{testResult.error}</span>
            )
          ) : null}
        </div>
      ) : null}
      <div className="novel-save-bar">
        <button
          className="novel-set-btn primary"
          disabled={saving || !draftValid}
          onClick={() => void save()}
          type="button"
        >
          <Check size={12} aria-hidden />
          {saving ? "保存中…" : "保存并继续"}
        </button>
      </div>
      {status !== "" ? (
        <p className="novel-provider-security-note" role="status">
          {status}
        </p>
      ) : null}
    </div>
  );
}

const fmtTokens = (n: number | undefined, fallback: string): string =>
  n === undefined ? fallback : n.toLocaleString("en-US");

function getErrorCode(error: unknown): string {
  if (error === null || typeof error !== "object") return "UNKNOWN_ERROR";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : "UNKNOWN_ERROR";
}
