/** Agent 运行参数设置：模型档位（Normal/Fast）+ 全局默认采样 + 按 Agent 覆盖 + 压缩阈值。 */
import { useEffect, useState } from "react";
import type { AgentRuntimeOverride, ConfigSnapshot, RuntimeSettings, ThinkingLevel } from "@novel/core";
import { FAST_PROFILE_REF } from "@novel/core";
import type { ApplicationConfigurationClient } from "./ApplicationConfigurationClient.js";

export interface AgentSettingsPanelProps {
  readonly configuration: ApplicationConfigurationClient;
}

/** 参与配置的 Agent 清单（agentType 对齐运行时装配） */
const AGENTS: readonly { id: string; name: string; desc: string }[] = [
  {
    id: "novel",
    name: "主创作",
    desc: "与你对话、规划并执笔的主 Agent（默认 Normal 档）· 上下文压缩仅作用于它",
  },
  {
    id: "Explore",
    name: "探索",
    desc: "只读检索大纲 / 人物 / 段落 · 建议走 Fast 快速档（便宜快速的模型）",
  },
  { id: "Compose", name: "起草", desc: "起草大纲与行文设计草案，不直接改动档案" },
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
  const [status, setStatus] = useState("正在读取配置…");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void configuration.load().then(
      (loaded) => {
        if (!active) return;
        setSnapshot(loaded);
        setDraft(toDraft(loaded));
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
      setDraft(toDraft(loaded));
      setStatus("已保存，对新对话生效（运行中的对话维持原参数）");
    } catch (error) {
      setStatus(`保存失败：${error instanceof Error ? error.message : getErrorCode(error)}`);
    } finally {
      setSaving(false);
    }
  }

  if (draft === undefined) {
    return (
      <section className="novel-agent-settings" aria-label="Agent 设置">
        <p className="novel-provider-security-note" role="status">
          {status}
        </p>
      </section>
    );
  }

  const profiles = snapshot?.profiles ?? [];
  const defaultProfile =
    profiles.find((p) => p.id === snapshot?.defaultProfileId) ?? profiles[0];
  const fastProfile =
    profiles.find((p) => p.id === draft.fastProfileId) ?? defaultProfile;
  const profileLabel = (id: string): string => {
    const p = profiles.find((x) => x.id === id);
    return p === undefined ? id : `${p.label ?? p.model} · ${p.model}`;
  };
  const globalTemperature =
    draft.defaultsTemperature.trim() !== "" ? draft.defaultsTemperature.trim() : "厂商默认";
  const globalMaxTokens =
    draft.defaultsMaxTokens.trim() !== "" ? draft.defaultsMaxTokens.trim() : "8192";

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
    <section className="novel-agent-settings" aria-label="Agent 设置">
      <header className="novel-model-settings-header">
        <div>
          <span>Agents</span>
          <h3>Agent 参数</h3>
          <p>模型档位 + 全局默认采样 + 按 Agent 覆盖 + 上下文压缩；保存后对新对话生效。</p>
        </div>
        <button disabled={saving} onClick={() => void save()} type="button">
          {saving ? "保存中…" : "保存"}
        </button>
      </header>

      <div className="novel-agent-section">
        <h4>模型档位</h4>
        <p className="novel-agent-hint">
          Normal = 「模型」页的默认服务（主创作）；Fast 建议绑定便宜快速的模型，供 Explore 等检索型 Agent 使用。
        </p>
        <div className="novel-provider-fields">
          <label>
            <span>Normal 常规</span>
            <input
              disabled
              aria-label="Normal 常规档"
              value={defaultProfile === undefined ? "未配置模型服务" : `${defaultProfile.label ?? defaultProfile.model} · ${defaultProfile.model}`}
            />
          </label>
          <label>
            <span>Fast 快速</span>
            <select
              aria-label="Fast 快速档"
              disabled={saving || profiles.length === 0}
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
          </label>
        </div>
      </div>

      <div className="novel-agent-section">
        <h4>全局默认采样</h4>
        <p className="novel-agent-hint">未被 Agent 覆盖的项对所有 Agent 生效；模型不支持温度时自动忽略。</p>
        <div className="novel-provider-fields">
          <label>
            <span>温度</span>
            <input
              aria-label="全局温度"
              disabled={saving}
              onChange={(event) => setDraft({ ...draft, defaultsTemperature: event.currentTarget.value })}
              placeholder="厂商默认（0 – 2，如 1.0）"
              value={draft.defaultsTemperature}
            />
          </label>
          <label>
            <span>思考强度</span>
            <select
              aria-label="全局思考强度"
              disabled={saving}
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
          </label>
          <label>
            <span>最大输出 Tokens</span>
            <input
              aria-label="全局最大输出"
              disabled={saving}
              onChange={(event) => setDraft({ ...draft, defaultsMaxTokens: event.currentTarget.value })}
              placeholder="默认 8192"
              value={draft.defaultsMaxTokens}
            />
          </label>
        </div>
      </div>

      <div className="novel-agent-section">
        <h4>Agent 覆盖（留空继承全局）</h4>
        <div className="novel-agent-cards">
          {AGENTS.map((agent) => {
            const d = draft.agents[agent.id] ?? emptyAgentDraft();
            const overridden =
              d.profileId !== "" ||
              d.temperature.trim() !== "" ||
              d.thinking !== "" ||
              d.maxTokens.trim() !== "";
            return (
              <article className="novel-agent-card" data-overridden={overridden} key={agent.id}>
                <header>
                  <strong>{agent.name}</strong>
                  <code>{agent.id}</code>
                  {overridden ? <span className="novel-agent-tag">已覆盖</span> : null}
                </header>
                <p className="novel-agent-hint">{agent.desc}</p>
                <div className="novel-provider-fields">
                  <label>
                    <span>模型</span>
                    <select
                      aria-label={`${agent.name}模型`}
                      disabled={saving}
                      onChange={(event) => patchAgent(agent.id, { profileId: event.currentTarget.value })}
                      value={d.profileId}
                    >
                      <option value="">
                        继承全局默认（Normal ·{" "}
                        {defaultProfile === undefined
                          ? "未配置"
                          : `${defaultProfile.label ?? defaultProfile.model} · ${defaultProfile.model}`}
                        ）
                      </option>
                      <option value={FAST_PROFILE_REF}>
                        Fast 快速 · {fastProfile === undefined ? "未配置" : `${fastProfile.label ?? fastProfile.model} · ${fastProfile.model}`}
                      </option>
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {profileLabel(p.id)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>温度</span>
                    <input
                      aria-label={`${agent.name}温度`}
                      disabled={saving}
                      onChange={(event) => patchAgent(agent.id, { temperature: event.currentTarget.value })}
                      placeholder={`继承全局 · ${globalTemperature}`}
                      value={d.temperature}
                    />
                  </label>
                  <label>
                    <span>思考强度</span>
                    <select
                      aria-label={`${agent.name}思考强度`}
                      disabled={saving}
                      onChange={(event) =>
                        patchAgent(agent.id, {
                          thinking: event.currentTarget.value as AgentDraft["thinking"],
                        })
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
                  </label>
                  <label>
                    <span>最大输出 Tokens</span>
                    <input
                      aria-label={`${agent.name}最大输出`}
                      disabled={saving}
                      onChange={(event) => patchAgent(agent.id, { maxTokens: event.currentTarget.value })}
                      placeholder={`继承全局 · ${globalMaxTokens}`}
                      value={d.maxTokens}
                    />
                  </label>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      <div className="novel-agent-section">
        <h4>上下文压缩（仅主 Agent · 三级门禁常开）</h4>
        <p className="novel-agent-hint">
          阈值按模型上下文窗口的百分比触发：T1 将旧工具输出骨架化，T2 在更高水位折叠为摘要。
        </p>
        <div className="novel-provider-fields">
          <label>
            <span>T1 骨架化 %</span>
            <input
              aria-label="T1 骨架化比例"
              disabled={saving}
              onChange={(event) => setDraft({ ...draft, compactionT1: event.currentTarget.value })}
              placeholder="默认 70"
              value={draft.compactionT1}
            />
          </label>
          <label>
            <span>T2 摘要折叠 %</span>
            <input
              aria-label="T2 摘要折叠比例"
              disabled={saving}
              onChange={(event) => setDraft({ ...draft, compactionT2: event.currentTarget.value })}
              placeholder="默认 92"
              value={draft.compactionT2}
            />
          </label>
          <label>
            <span>摘要输出上限 Tokens</span>
            <input
              aria-label="摘要输出上限"
              disabled={saving}
              onChange={(event) => setDraft({ ...draft, compactionSummary: event.currentTarget.value })}
              placeholder="默认 2048"
              value={draft.compactionSummary}
            />
          </label>
        </div>
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
