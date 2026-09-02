/** 技能设置面板：扫描两级 skills 目录，展示当前生效技能清单并支持启停（skills.setDisabled）。 */
import { useCallback, useEffect, useState } from "react";
import { Check, RefreshCw, Sparkles } from "lucide-react";
import type { SkillsListEntry, SkillsListResult } from "@novel/core";
import type { ApplicationConfigurationClient } from "./ApplicationConfigurationClient.js";

export interface SkillsSettingsPanelProps {
  readonly configuration: ApplicationConfigurationClient;
}

/** 来源标签文案 */
const SOURCE_LABELS: Readonly<Record<SkillsListEntry["source"], string>> = {
  app: "应用级",
  project: "项目级",
};

function getErrorCode(error: unknown): string {
  if (error === null || typeof error !== "object") return "UNKNOWN_ERROR";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : "UNKNOWN_ERROR";
}

export function SkillsSettingsPanel({ configuration }: SkillsSettingsPanelProps) {
  const [result, setResult] = useState<SkillsListResult>();
  const [status, setStatus] = useState("正在读取技能清单…");
  const [toggling, setToggling] = useState<string | undefined>(undefined);

  const reload = useCallback(async () => {
    if (configuration.skillsList === undefined) {
      setStatus("技能系统未装配（当前宿主未接线技能目录扫描）");
      return;
    }
    setStatus("正在读取技能清单…");
    try {
      const loaded = await configuration.skillsList();
      setResult(loaded);
      setStatus(
        loaded.skills.length === 0
          ? "未发现技能包"
          : `共 ${loaded.skills.length} 项技能（生效 ${loaded.skills.filter((s) => !s.disabled).length} 项）`,
      );
    } catch (error) {
      setStatus(`读取失败：${error instanceof Error ? error.message : getErrorCode(error)}`);
    }
  }, [configuration]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** 单项启停：合并现有禁用名单后整体落库，再重扫（新会话生效） */
  async function toggle(entry: SkillsListEntry): Promise<void> {
    if (result === undefined || toggling !== undefined) return;
    const current = result.skills.filter((s) => s.disabled).map((s) => s.name);
    const next = entry.disabled ? current.filter((n) => n !== entry.name) : [...current, entry.name];
    setToggling(entry.name);
    setStatus("正在保存…");
    try {
      await configuration.mutate({ op: "skills.setDisabled", names: next });
      await reload();
      setStatus(`已${entry.disabled ? "启用" : "禁用"}「${entry.name}」，对新会话生效`);
    } catch (error) {
      setStatus(`保存失败：${error instanceof Error ? error.message : getErrorCode(error)}`);
      await reload();
    } finally {
      setToggling(undefined);
    }
  }

  if (configuration.skillsList === undefined) {
    return (
      <section className="novel-model-settings" aria-label="技能设置">
        <header className="novel-model-settings-header">
          <div>
            <span>Skills</span>
            <h3>技能</h3>
            <p>Agent Skills 开放标准：按需装载的写作技法与规范知识。</p>
          </div>
        </header>
        <p className="novel-provider-security-note" role="status">
          技能系统未装配（当前宿主未接线技能目录扫描）
        </p>
      </section>
    );
  }

  const effective = (result?.skills ?? []).filter((s) => !s.disabled);
  const disabled = (result?.skills ?? []).filter((s) => s.disabled);

  return (
    <section className="novel-model-settings" aria-label="技能设置">
      <header className="novel-model-settings-header">
        <div>
          <span>Skills</span>
          <h3>技能</h3>
          <p>当前生效技能 · 变更对新会话生效（运行中的会话维持装载快照）。</p>
        </div>
        <button
          className="novel-set-btn"
          disabled={toggling !== undefined}
          onClick={() => void reload()}
          type="button"
        >
          <RefreshCw size={12} aria-hidden />
          刷新
        </button>
      </header>

      {result !== undefined && result.skills.length === 0 ? (
        <div className="novel-set-section">
          <b>未发现技能包</b>
          <small>放置后点「刷新」即可装载</small>
        </div>
      ) : null}
      {result !== undefined && result.skills.length === 0 ? (
        <>
          <p className="novel-set-hint">
            技能 = 一个目录 + 一份 SKILL.md（YAML frontmatter 的 name / description + Markdown 正文）。
            兼容 Agent Skills 开放标准，可直接用生态 CLI 安装：
          </p>
          <p className="novel-set-hint">
            <code>npx skills add &lt;owner&gt;/&lt;repo&gt;</code>
          </p>
          <div className="novel-set-field">
            <label htmlFor="skills-app-root">应用级目录（所有项目共享）</label>
            <input
              aria-label="应用级技能目录"
              className="novel-set-input"
              id="skills-app-root"
              readOnly
              value={result.appRoot}
            />
          </div>
          {result.projectRoot !== undefined ? (
            <div className="novel-set-field">
              <label htmlFor="skills-project-root">项目级目录（当前工作台）</label>
              <input
                aria-label="项目级技能目录"
                className="novel-set-input"
                id="skills-project-root"
                readOnly
                value={result.projectRoot}
              />
            </div>
          ) : null}
        </>
      ) : null}

      {effective.length > 0 ? (
        <>
          <div className="novel-set-section">
            <b>生效中</b>
            <small>{effective.length} 项 · 已进入系统提示技能索引</small>
          </div>
          {effective.map((skill) => (
            <SkillCard
              disabled={false}
              key={`${skill.source}:${skill.name}`}
              onToggle={() => void toggle(skill)}
              skill={skill}
              toggling={toggling === skill.name}
            />
          ))}
        </>
      ) : null}

      {disabled.length > 0 ? (
        <>
          <div className="novel-set-section">
            <b>已禁用</b>
            <small>{disabled.length} 项 · 不进入技能索引</small>
          </div>
          {disabled.map((skill) => (
            <SkillCard
              disabled
              key={`${skill.source}:${skill.name}`}
              onToggle={() => void toggle(skill)}
              skill={skill}
              toggling={toggling === skill.name}
            />
          ))}
        </>
      ) : null}

      {result !== undefined && result.projectRoot === undefined ? (
        <p className="novel-set-hint">未打开工作区：项目级技能目录需打开工作台后可用。</p>
      ) : null}

      <p className="novel-provider-security-note" role="status">
        {status}
      </p>
    </section>
  );
}

function SkillCard({
  skill,
  disabled,
  toggling,
  onToggle,
}: {
  skill: SkillsListEntry;
  disabled: boolean;
  toggling: boolean;
  onToggle: () => void;
}) {
  return (
    <article className="novel-agent-card" data-overridden={disabled || undefined} data-disabled={disabled}>
      <header className="novel-agent-head">
        <Sparkles size={13} aria-hidden />
        <b>{skill.name}</b>
        <span className="novel-agent-role">{SOURCE_LABELS[skill.source]}</span>
        {disabled ? <span className="novel-ov-tag">已禁用</span> : null}
      </header>
      <p className="novel-agent-desc">{skill.description}</p>
      <p className="novel-set-hint" title={skill.dir}>
        {skill.dir}
      </p>
      <div className="novel-save-bar">
        <span className="novel-set-hint">
          {disabled ? "启用后进入技能索引" : "AI 可经 skill 工具读取全文"}
        </span>
        <span style={{ flex: 1 }} />
        <button
          aria-label={disabled ? `启用 ${skill.name}` : `禁用 ${skill.name}`}
          className="novel-set-btn"
          disabled={toggling}
          onClick={onToggle}
          type="button"
        >
          <Check size={12} aria-hidden />
          {toggling ? "处理中…" : disabled ? "启用" : "禁用"}
        </button>
      </div>
    </article>
  );
}
