/** Agent 运行参数设置：模型档位（Normal/Fast）+ 全局默认采样 + 按 Agent 覆盖 + 压缩阈值。 */
import { useEffect, useState } from "react";
import { Check, Feather, RotateCcw, ScrollText, Search } from "lucide-react";
// 运行时值必须走 browser-safe 的 /client 出口（根入口会拖入 zeromq 等 node 依赖 → renderer 白屏）
import { FAST_PROFILE_REF } from "@novel/core/client";
import type { AgentRuntimeOverride, ConfigSnapshot, RuntimeSettings, ThinkingLevel } from "@novel/core";
import type { ApplicationConfigurationClient } from "./ApplicationConfigurationClient.js";

export interface AgentSettingsPanelProps {
  readonly configuration: ApplicationConfigurationClient;
}

/** 参与配置的 Agent 清单（agentType 对齐运行时装配） */
const AGENTS: readonly {
  id: string;
  name: string;
  icon: typeof Feather;
  desc: string;
}[] = [
  {
    id: "novel",
    name: "主创作",
    icon: Feather,
    desc: "与你对话、规划并执笔的主 Agent（默认 Normal 档）· 上下文压缩仅作用于它。",
  },
  {
    id: "Explore",
    name: "探索",
    icon: Search,
    desc: "只读检索大纲 / 人物 / 段落 · 默认走 Fast 快速档，适合便宜快速的模型。",
  },
  { id: "Compose", name: "起草", icon: ScrollText, desc: "起草大纲与行文设计草案，不直接改动档案。" },
];

const THINKING_LEVELS: readonly { value: ThinkingLevel; label: string }[] = [
  { value: "off", label: "关闭" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "xhigh", label: "加高" },
  { value: "max", label: "最大" },
];

/** 单 Agent 覆盖 draft（字符串态；空 = 继承全局） */
interface AgentDraft {
  readonly profileId: string;
  readonly temperature: string;
  readonly thinking: "" | ThinkingLevel;
  readonly maxTokens: string;
}

interface RuntimeDraft {
  readonly fastProfileId: string;
  readonly defaultsTemperature: string;
  readonly defaultsThinking: ThinkingLevel;
  readonly defaultsMaxTokens: string;
  readonly agents: Readonly<Record<string, AgentDraft>>;
  readonly compactionT1: string;
  readonly compactionT2: string;
  readonly compactionSummary: string;
}

function emptyAgentDraft(): AgentDraft {
  return { profileId: "", temperature: "", thinking: "", maxTokens: "" };
}

function toDraft(snapshot: ConfigSnapshot | undefined): RuntimeDraft {
  const runtime = snapshot?.runtime;
  const agents: Record<string, AgentDraft> = {};
  for (const agent of AGENTS) {
    const override = runtime?.agents[agent.id];
    agents[agent.id] = {
      profileId: override?.profileId ?? "",
      temperature: override?.temperature !== undefined ? String(override.temperature) : "",
      thinking: override?.thinking ?? "",
      maxTokens: override?.maxTokens !== undefined ? String(override.maxTokens) : "",
    };
  }
  return {
    fastProfileId: runtime?.fastProfileId ?? "",
    defaultsTemperature:
      runtime?.samplingDefaults.temperature !== undefined
        ? String(runtime.samplingDefaults.temperature)
        : "",
    defaultsThinking: runtime?.samplingDefaults.thinking ?? "high",
    defaultsMaxTokens:
      runtime?.samplingDefaults.maxTokens !== undefined
        ? String(runtime.samplingDefaults.maxTokens)
        : "8192",
    agents,
    compactionT1: String(Math.round((runtime?.compaction.t1Ratio ?? 0.7) * 100)),
    compactionT2: String(Math.round((runtime?.compaction.t2CapRatio ?? 0.92) * 100)),
    compactionSummary: String(runtime?.compaction.summaryMaxTokens ?? 2048),
  };
}

function parseIntField(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  return Number.isInteger(n) && n > 0 ? n : Number.NaN;
}

function parseTemperature(value: string): number | undefined | typeof Number.NaN {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  return n >= 0 && n <= 2 ? n : Number.NaN;
}

/** draft → RuntimeSettings（校验失败抛 Error，由保存流程转状态行） */
function buildRuntime(draft: RuntimeDraft): RuntimeSettings {
  const defaultsTemperature = parseTemperature(draft.defaultsTemperature);
  if (Number.isNaN(defaultsTemperature)) throw new Error("全局温度需在 0 – 2 之间");
  const defaultsMaxTokens = parseIntField(draft.defaultsMaxTokens);
  if (defaultsMaxTokens === undefined || Number.isNaN(defaultsMaxTokens)) {
    throw new Error("全局最大输出需为正整数");
  }
  const agents: Record<string, AgentRuntimeOverride> = {};
  for (const agent of AGENTS) {
    const d = draft.agents[agent.id] ?? emptyAgentDraft();
    const temperature = parseTemperature(d.temperature);
    if (Number.isNaN(temperature)) throw new Error(`「${agent.name}」温度覆盖需在 0 – 2 之间`);
    const maxTokens = parseIntField(d.maxTokens);
    if (maxTokens !== undefined && Number.isNaN(maxTokens)) {
      throw new Error(`「${agent.name}」最大输出覆盖需为正整数`);
    }
    agents[agent.id] = {
      ...(d.profileId !== "" ? { profileId: d.profileId } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(d.thinking !== "" ? { thinking: d.thinking } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
    };
  }
  const t1 = Number(draft.compactionT1);
  const t2 = Number(draft.compactionT2);
  if (!(Number.isInteger(t1) && t1 > 0 && t1 < 100)) throw new Error("T1 比例需为 1 – 99 的整数");
  if (!(Number.isInteger(t2) && t2 > 0 && t2 < 100)) throw new Error("T2 比例需为 1 – 99 的整数");
  if (t1 >= t2) throw new Error("压缩比例需满足 T1 < T2");
  const summary = parseIntField(draft.compactionSummary);
  if (summary === undefined || Number.isNaN(summary)) throw new Error("摘要输出上限需为正整数");
  return {
    ...(draft.fastProfileId !== "" ? { fastProfileId: draft.fastProfileId } : {}),
    samplingDefaults: {
      ...(defaultsTemperature !== undefined ? { temperature: defaultsTemperature } : {}),
      thinking: draft.defaultsThinking,
      maxTokens: defaultsMaxTokens!,
    },
    agents,
    compaction: {
      t1Ratio: t1 / 100,
      t2CapRatio: t2 / 100,
      summaryMaxTokens: summary!,
    },
  };
}

export function AgentSettingsPanel({ configuration }: AgentSettingsPanelProps) {
  const [snapshot, setSnapshot] = useState<ConfigSnapshot>();
  const [draft, setDraft] = useState<RuntimeDraft>();
  /** 上次保存的 draft（脏态判定 + 还原基准） */
  const [savedDraft, setSavedDraft] = useState<RuntimeDraft>();
  const [status, setStatus] = useState("正在读取配置…");
  const [saving, setSaving] = useState(false);
  // 启动时快照（会话期间不变）：false = 回显模式，provider 修改需重启生效
  const [providerLive, setProviderLive] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void configuration.load().then(
      (loaded) => {
        if (!active) return;
        setSnapshot(loaded);
        const next = toDraft(loaded);
        setDraft(next);
        setSavedDraft(next);
        setStatus("配置已加载");
      },
      (error: unknown) => {
        if (!active) return;
        setStatus(`读取失败：${getErrorCode(error)}`);
      },
    );
    // 运行形态查询失败静默（undefined = 未知 → 维持现状文案）
    configuration.runtimeStatus?.().then(
      (runtime) => {
        if (active) setProviderLive(runtime.providerLive);
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, [configuration]);

  async function save(): Promise<void> {
    if (draft === undefined) return;
    let runtime: RuntimeSettings;
    try {
      runtime = buildRuntime(draft);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "配置非法");
      return;
    }
    setSaving(true);
    setStatus("正在保存…");
    try {
      await configuration.mutate({ op: "runtime.set", runtime });
      const loaded = await configuration.load();
      setSnapshot(loaded);
      const next = toDraft(loaded);
      setDraft(next);
      setSavedDraft(next);
      setStatus(
        providerLive === false
          ? "已保存 · 当前为回显模式，连接真实模型需重启程序"
          : "已保存，对新对话生效（运行中的对话维持原参数）",
      );
    } catch (error) {
      setStatus(`保存失败：${error instanceof Error ? error.message : getErrorCode(error)}`);
    } finally {
      setSaving(false);
    }
  }

  if (draft === undefined) {
    return (
      <section className="novel-model-settings" aria-label="Agent 设置">
        <p className="novel-provider-security-note" role="status">
          {status}
        </p>
      </section>
    );
  }

  const profiles = snapshot?.profiles ?? [];
  const defaultProfile = profiles.find((p) => p.id === snapshot?.defaultProfileId) ?? profiles[0];
  const fastProfile = profiles.find((p) => p.id === draft.fastProfileId) ?? defaultProfile;
  const defaultLabel =
    defaultProfile === undefined ? "未配置" : `${defaultProfile.label ?? defaultProfile.model} · ${defaultProfile.model}`;
  const fastLabel =
    fastProfile === undefined ? "未配置" : `${fastProfile.label ?? fastProfile.model} · ${fastProfile.model}`;
  const globalTemperature =
    draft.defaultsTemperature.trim() !== "" ? draft.defaultsTemperature.trim() : "厂商默认";
  const globalMaxTokens = draft.defaultsMaxTokens.trim() !== "" ? draft.defaultsMaxTokens.trim() : "8192";
  const dirty = savedDraft !== undefined && JSON.stringify(draft) !== JSON.stringify(savedDraft);

  const patchAgent = (id: string, patch: Partial<AgentDraft>): void => {
    setDraft({
      ...draft,
      agents: {
        ...draft.agents,
        [id]: { ...(draft.agents[id] ?? emptyAgentDraft()), ...patch },
      },
    });
  };

  return (
    <section className="novel-model-settings" aria-label="Agent 设置">
      <header className="novel-model-settings-header">
        <div>
          <span>Agents</span>
          <h3>Agent 参数</h3>
          <p>模型档位 + 全局默认采样 + 按 Agent 覆盖 + 上下文压缩。</p>
        </div>
      </header>

      <div className="novel-set-section">
        <b>模型档位</b>
        <small>命名档位 · Agent 卡可直接选用</small>
      </div>
      <p className="novel-set-hint">
        Normal = 「模型」页的默认服务（主创作）；Fast 建议绑定便宜快速的模型，供 Explore 等检索型 Agent 使用。
      </p>
      <div className="novel-set-field">
        <label htmlFor="tier-normal">Normal 常规</label>
        <input aria-label="Normal 常规档" className="novel-set-input" disabled value={defaultLabel} id="tier-normal" />
      </div>
      <div className="novel-set-field">
        <label htmlFor="tier-fast">Fast 快速</label>
        <span className="novel-set-select-wrap">
          <select
            aria-label="Fast 快速档"
            className="novel-set-select"
            disabled={saving || profiles.length === 0}
            id="tier-fast"
            onChange={(event) => setDraft({ ...draft, fastProfileId: event.currentTarget.value })}
            value={draft.fastProfileId}
          >
            {profiles.length === 0 ? <option value="">未配置模型服务</option> : null}
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label ?? p.model} · {p.model}
              </option>
            ))}
          </select>
        </span>
      </div>

      <div className="novel-set-section">
        <b>全局默认采样</b>
        <small>未被覆盖的项对所有 Agent 生效</small>
      </div>
      <p className="novel-set-hint">修改对新对话生效；模型不支持温度时自动忽略。</p>
      <div className="novel-set-field">
        <label htmlFor="global-temp">温度</label>
        <input
          aria-label="全局温度"
          className="novel-set-input"
          disabled={saving}
          id="global-temp"
          inputMode="decimal"
          onChange={(event) => setDraft({ ...draft, defaultsTemperature: event.currentTarget.value })}
          placeholder="厂商默认（0 – 2，如 1.0）"
          value={draft.defaultsTemperature}
        />
      </div>
      <div className="novel-set-field">
        <label htmlFor="global-thinking">思考强度</label>
        <span className="novel-set-select-wrap">
          <select
            aria-label="全局思考强度"
            className="novel-set-select"
            disabled={saving}
            id="global-thinking"
            onChange={(event) =>
              setDraft({ ...draft, defaultsThinking: event.currentTarget.value as ThinkingLevel })
            }
            value={draft.defaultsThinking}
          >
            {THINKING_LEVELS.map((level) => (
              <option key={level.value} value={level.value}>
                {level.label}
              </option>
            ))}
          </select>
        </span>
      </div>
      <div className="novel-set-field">
        <label htmlFor="global-max-tokens">最大输出</label>
        <input
          aria-label="全局最大输出"
          className="novel-set-input"
          disabled={saving}
          id="global-max-tokens"
          inputMode="numeric"
          onChange={(event) => setDraft({ ...draft, defaultsMaxTokens: event.currentTarget.value })}
          placeholder="默认 8192 tokens"
          value={draft.defaultsMaxTokens}
        />
      </div>

      <div className="novel-set-section">
        <b>Agent 覆盖</b>
        <small>留空继承全局</small>
      </div>
      {AGENTS.map((agent) => {
        const d = draft.agents[agent.id] ?? emptyAgentDraft();
        const overridden =
          d.profileId !== "" ||
          d.temperature.trim() !== "" ||
          d.thinking !== "" ||
          d.maxTokens.trim() !== "";
        const Icon = agent.icon;
        return (
          <article className="novel-agent-card" data-overridden={overridden} key={agent.id}>
            <header className="novel-agent-head">
              <Icon size={13} aria-hidden />
              <b>{agent.name}</b>
              <span className="novel-agent-role">{agent.id}</span>
              {overridden ? <span className="novel-ov-tag">已覆盖</span> : null}
            </header>
            <p className="novel-agent-desc">{agent.desc}</p>
            <div className="novel-set-field">
              <label htmlFor={`agent-${agent.id}-model`}>模型</label>
              <span className="novel-set-select-wrap">
                <select
                  aria-label={`${agent.name}模型`}
                  className="novel-set-select"
                  disabled={saving}
                  id={`agent-${agent.id}-model`}
                  onChange={(event) => patchAgent(agent.id, { profileId: event.currentTarget.value })}
                  value={d.profileId}
                >
                  <option value="">继承全局默认（Normal · {defaultLabel}）</option>
                  <option value={FAST_PROFILE_REF}>Fast 快速 · {fastLabel}</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label ?? p.model} · {p.model}
                    </option>
                  ))}
                </select>
              </span>
            </div>
            <div className="novel-set-field">
              <label htmlFor={`agent-${agent.id}-temp`}>温度</label>
              <input
                aria-label={`${agent.name}温度`}
                className="novel-set-input"
                disabled={saving}
                id={`agent-${agent.id}-temp`}
                inputMode="decimal"
                onChange={(event) => patchAgent(agent.id, { temperature: event.currentTarget.value })}
                placeholder={`继承全局 · ${globalTemperature}`}
                value={d.temperature}
              />
            </div>
            <div className="novel-set-field">
              <label htmlFor={`agent-${agent.id}-thinking`}>思考强度</label>
              <span className="novel-set-select-wrap">
                <select
                  aria-label={`${agent.name}思考强度`}
                  className="novel-set-select"
                  disabled={saving}
                  id={`agent-${agent.id}-thinking`}
                  onChange={(event) =>
                    patchAgent(agent.id, { thinking: event.currentTarget.value as AgentDraft["thinking"] })
                  }
                  value={d.thinking}
                >
                  <option value="">继承全局 · {draft.defaultsThinking}</option>
                  {THINKING_LEVELS.map((level) => (
                    <option key={level.value} value={level.value}>
                      {level.label}
                    </option>
                  ))}
                </select>
              </span>
            </div>
            <div className="novel-set-field">
              <label htmlFor={`agent-${agent.id}-max-tokens`}>最大输出</label>
              <input
                aria-label={`${agent.name}最大输出`}
                className="novel-set-input"
                disabled={saving}
                id={`agent-${agent.id}-max-tokens`}
                inputMode="numeric"
                onChange={(event) => patchAgent(agent.id, { maxTokens: event.currentTarget.value })}
                placeholder={`继承全局 · ${globalMaxTokens} tokens`}
                value={d.maxTokens}
              />
            </div>
          </article>
        );
      })}

      <div className="novel-set-section">
        <b>上下文压缩</b>
        <small>仅主 Agent · 三级门禁常开</small>
      </div>
      <p className="novel-set-hint">
        阈值按模型上下文窗口的百分比触发：T1 将旧工具输出骨架化，T2 在更高水位折叠为摘要。
      </p>
      <div className="novel-set-field">
        <label htmlFor="compact-t1">T1 骨架化 %</label>
        <input
          aria-label="T1 骨架化比例"
          className="novel-set-input"
          disabled={saving}
          id="compact-t1"
          inputMode="numeric"
          onChange={(event) => setDraft({ ...draft, compactionT1: event.currentTarget.value })}
          placeholder="默认 70"
          value={draft.compactionT1}
        />
      </div>
      <div className="novel-set-field">
        <label htmlFor="compact-t2">T2 摘要折叠 %</label>
        <input
          aria-label="T2 摘要折叠比例"
          className="novel-set-input"
          disabled={saving}
          id="compact-t2"
          inputMode="numeric"
          onChange={(event) => setDraft({ ...draft, compactionT2: event.currentTarget.value })}
          placeholder="默认 92"
          value={draft.compactionT2}
        />
      </div>
      <div className="novel-set-field">
        <label htmlFor="compact-summary">摘要输出上限</label>
        <input
          aria-label="摘要输出上限"
          className="novel-set-input"
          disabled={saving}
          id="compact-summary"
          inputMode="numeric"
          onChange={(event) => setDraft({ ...draft, compactionSummary: event.currentTarget.value })}
          placeholder="默认 2048 tokens"
          value={draft.compactionSummary}
        />
      </div>

      <div className="novel-save-bar">
        {dirty ? <span className="novel-dirty-dot">● 有未保存的修改</span> : null}
        <span style={{ flex: 1 }} />
        <button
          className="novel-set-btn"
          disabled={saving || savedDraft === undefined}
          onClick={() => savedDraft !== undefined && setDraft(savedDraft)}
          type="button"
        >
          <RotateCcw size={12} aria-hidden />
          还原
        </button>
        <button className="novel-set-btn primary" disabled={saving} onClick={() => void save()} type="button">
          <Check size={12} aria-hidden />
          {saving ? "保存中…" : "保存"}
        </button>
      </div>

      <p className="novel-provider-security-note" role="status">
        {status}
      </p>
    </section>
  );
}

function getErrorCode(error: unknown): string {
  if (error === null || typeof error !== "object") return "UNKNOWN_ERROR";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : "UNKNOWN_ERROR";
}
