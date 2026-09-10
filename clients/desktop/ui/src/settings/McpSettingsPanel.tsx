/** MCP 服务器设置面板：服务器卡片（启停/信任/编辑/删除）+ draft 表单（增改 + 测试连接 + 工具预览）。 */
import { useCallback, useEffect, useState } from "react";
import { Check, Plug, PlugZap, RotateCcw, Trash2, X } from "lucide-react";
import type { McpServerConfig, McpServerInput, McpTestResult } from "@novel/core";
import type { ApplicationConfigurationClient } from "./ApplicationConfigurationClient.js";

export interface McpSettingsPanelProps {
  readonly configuration: ApplicationConfigurationClient;
}

/** draft 表单（字符串态；args 按空白切分） */
interface McpDraft {
  readonly id?: string;
  readonly name: string;
  readonly type: "stdio" | "http";
  readonly command: string;
  readonly args: string;
  readonly url: string;
  readonly enabled: boolean;
  readonly trusted: boolean;
}

function emptyDraft(): McpDraft {
  return { name: "", type: "stdio", command: "", args: "", url: "", enabled: true, trusted: false };
}

function toDraft(server: McpServerConfig): McpDraft {
  return {
    id: server.id,
    name: server.name,
    type: server.transport.type,
    command: server.transport.type === "stdio" ? server.transport.command : "",
    args: server.transport.type === "stdio" ? server.transport.args.join(" ") : "",
    url: server.transport.type === "http" ? server.transport.url : "",
    enabled: server.enabled,
    trusted: server.trusted,
  };
}

/** draft → 输入校验（失败抛 Error，中文消息） */
function buildInput(draft: McpDraft): McpServerInput {
  const name = draft.name.trim();
  if (name.length === 0 || name.length > 64) throw new Error("名称需为 1 – 64 字符");
  if (draft.type === "stdio") {
    if (draft.command.trim().length === 0) throw new Error("stdio 传输需填写命令（command）");
    return {
      name,
      transport: { type: "stdio", command: draft.command.trim(), args: draft.args.split(/\s+/).filter(Boolean) },
      enabled: draft.enabled,
      trusted: draft.trusted,
    };
  }
  if (!/^https?:\/\/.+/.test(draft.url.trim())) throw new Error("http 传输需填写合法的 http/https 地址");
  return {
    name,
    transport: { type: "http", url: draft.url.trim() },
    enabled: draft.enabled,
    trusted: draft.trusted,
  };
}

function transportSummary(server: McpServerConfig): string {
  return server.transport.type === "stdio"
    ? `${server.transport.command} ${server.transport.args.join(" ")}`.trim()
    : server.transport.url;
}

function getErrorCode(error: unknown): string {
  if (error === null || typeof error !== "object") return "UNKNOWN_ERROR";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : "UNKNOWN_ERROR";
}

export function McpSettingsPanel({ configuration }: McpSettingsPanelProps) {
  const [servers, setServers] = useState<readonly McpServerConfig[]>([]);
  const [draft, setDraft] = useState<McpDraft>(emptyDraft());
  const [status, setStatus] = useState("正在读取配置…");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<McpTestResult>();
  const [confirmingDelete, setConfirmingDelete] = useState<string | undefined>(undefined);

  const reload = useCallback(async () => {
    try {
      const snapshot = await configuration.load();
      setServers([...(snapshot.mcpServers ?? [])]);
      setStatus("配置已加载");
    } catch (error) {
      setStatus(`读取失败：${error instanceof Error ? error.message : getErrorCode(error)}`);
    }
  }, [configuration]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** 保存 draft（新增或编辑；成功后重载并清空 draft） */
  async function save(): Promise<void> {
    let input: McpServerInput;
    try {
      input = buildInput(draft);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "配置非法");
      return;
    }
    setBusy(true);
    setStatus("正在保存…");
    try {
      const serverId = draft.id ?? `mcp_${Date.now().toString(36)}`;
      await configuration.mutate({ op: "mcp.upsert", serverId, server: input });
      await reload();
      setDraft(emptyDraft());
      setTestResult(undefined);
      setStatus("已保存，对新会话生效（运行中的会话维持启动快照）");
    } catch (error) {
      setStatus(`保存失败：${error instanceof Error ? error.message : getErrorCode(error)}`);
    } finally {
      setBusy(false);
    }
  }

  /** 服务器字段覆盖（启停/信任开关） */
  async function patch(server: McpServerConfig, patchInput: Partial<McpServerInput>): Promise<void> {
    setBusy(true);
    try {
      await configuration.mutate({
        op: "mcp.upsert",
        serverId: server.id,
        server: {
          name: server.name,
          transport: server.transport,
          enabled: server.enabled,
          trusted: server.trusted,
          ...patchInput,
        },
      });
      await reload();
      setStatus("已更新，对新会话生效");
    } catch (error) {
      setStatus(`更新失败：${error instanceof Error ? error.message : getErrorCode(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function testDraft(): Promise<void> {
    if (configuration.testMcp === undefined) return;
    let input: McpServerInput;
    try {
      input = buildInput(draft);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "配置非法");
      return;
    }
    setTesting(true);
    setTestResult(undefined);
    setStatus("正在测试连接…");
    try {
      const result = await configuration.testMcp(input);
      if (result === undefined) {
        setStatus("当前宿主不支持 MCP 连接测试");
        return;
      }
      setTestResult(result);
      setStatus(result.ok ? `连接正常 ✓ 提供 ${result.toolCount} 个工具` : `连接失败：${result.error}`);
    } catch (error) {
      setStatus(`测试请求失败（无法连接配置服务）：${getErrorCode(error)}`);
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="novel-model-settings" aria-label="MCP 服务器设置">
      <header className="novel-model-settings-header">
        <div>
          <span>MCP</span>
          <h3>MCP 服务器</h3>
          <p>外部工具接入（Model Context Protocol）· 变更对新会话生效。</p>
        </div>
      </header>

      <p className="novel-set-hint">
        外部工具调用默认进入审批清单（按轮批量批准）；开启「信任」后该服务器的工具免审直通。
      </p>

      {servers.length === 0 ? (
        <p className="novel-set-hint">尚未添加 MCP 服务器——在下方表单填写并保存。</p>
      ) : (
        servers.map((server) => (
          <article className="novel-agent-card" key={server.id} data-overridden={!server.enabled || undefined}>
            <header className="novel-agent-head">
              <Plug size={13} aria-hidden />
              <b>{server.name}</b>
              <span className="novel-agent-role">{server.transport.type}</span>
              {!server.enabled ? <span className="novel-ov-tag">已停用</span> : null}
              {server.trusted ? <span className="novel-ov-tag">信任</span> : null}
            </header>
            <p className="novel-set-hint" title={transportSummary(server)}>
              {transportSummary(server)}
            </p>
            <div className="novel-save-bar">
              <label className="novel-set-hint">
                <input
                  aria-label={`启用 ${server.name}`}
                  checked={server.enabled}
                  disabled={busy}
                  onChange={(event) => void patch(server, { enabled: event.currentTarget.checked })}
                  type="checkbox"
                />{" "}
                启用
              </label>
              <label className="novel-set-hint">
                <input
                  aria-label={`信任 ${server.name}`}
                  checked={server.trusted}
                  disabled={busy}
                  onChange={(event) => void patch(server, { trusted: event.currentTarget.checked })}
                  type="checkbox"
                />{" "}
                信任（免审批）
              </label>
              <span style={{ flex: 1 }} />
              <button
                className="novel-set-btn"
                disabled={busy}
                onClick={() => {
                  setDraft(toDraft(server));
                  setTestResult(undefined);
                }}
                type="button"
              >
                <RotateCcw size={12} aria-hidden />
                编辑
              </button>
              {confirmingDelete === server.id ? (
                <button
                  className="novel-set-btn"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await configuration.mutate({ op: "mcp.remove", serverId: server.id });
                      await reload();
                      setStatus("已删除");
                    } catch (error) {
                      setStatus(`删除失败：${error instanceof Error ? error.message : getErrorCode(error)}`);
                    } finally {
                      setBusy(false);
                      setConfirmingDelete(undefined);
                    }
                  }}
                  type="button"
                >
                  <Trash2 size={12} aria-hidden />
                  确认删除
                </button>
              ) : (
                <button
                  className="novel-set-btn"
                  disabled={busy}
                  onClick={() => setConfirmingDelete(server.id)}
                  type="button"
                >
                  <Trash2 size={12} aria-hidden />
                  删除
                </button>
              )}
            </div>
          </article>
        ))
      )}

      <div className="novel-set-section">
        <b>{draft.id !== undefined ? "编辑服务器" : "添加服务器"}</b>
        <small>{draft.id !== undefined ? "保存后覆盖原配置" : "stdio 本地子进程 / http 远程服务器"}</small>
      </div>
      <div className="novel-set-field">
        <label htmlFor="mcp-name">名称</label>
        <input
          aria-label="MCP 服务器名称"
          className="novel-set-input"
          disabled={busy}
          id="mcp-name"
          onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
          placeholder="如：天气查询"
          value={draft.name}
        />
      </div>
      <div className="novel-set-field">
        <label htmlFor="mcp-type">传输类型</label>
        <span className="novel-set-select-wrap">
          <select
            aria-label="MCP 传输类型"
            className="novel-set-select"
            disabled={busy}
            id="mcp-type"
            onChange={(event) => setDraft({ ...draft, type: event.currentTarget.value as McpDraft["type"] })}
            value={draft.type}
          >
            <option value="stdio">stdio（本地命令）</option>
            <option value="http">http（远程 URL）</option>
          </select>
        </span>
      </div>
      {draft.type === "stdio" ? (
        <>
          <div className="novel-set-field">
            <label htmlFor="mcp-command">命令</label>
            <input
              aria-label="MCP stdio 命令"
              className="novel-set-input"
              disabled={busy}
              id="mcp-command"
              onChange={(event) => setDraft({ ...draft, command: event.currentTarget.value })}
              placeholder="如 npx（Windows 下 npx 类命令可能需 npx.cmd）"
              value={draft.command}
            />
          </div>
          <div className="novel-set-field">
            <label htmlFor="mcp-args">参数</label>
            <input
              aria-label="MCP stdio 参数"
              className="novel-set-input"
              disabled={busy}
              id="mcp-args"
              onChange={(event) => setDraft({ ...draft, args: event.currentTarget.value })}
              placeholder="按空白分隔，如 -y weather-mcp"
              value={draft.args}
            />
          </div>
        </>
      ) : (
        <div className="novel-set-field">
          <label htmlFor="mcp-url">服务器 URL</label>
          <input
            aria-label="MCP http URL"
            className="novel-set-input"
            disabled={busy}
            id="mcp-url"
            onChange={(event) => setDraft({ ...draft, url: event.currentTarget.value })}
            placeholder="https://example.com/mcp"
            value={draft.url}
          />
        </div>
      )}
      <div className="novel-save-bar">
        <label className="novel-set-hint">
          <input
            checked={draft.enabled}
            disabled={busy}
            onChange={(event) => setDraft({ ...draft, enabled: event.currentTarget.checked })}
            type="checkbox"
          />{" "}
          启用
        </label>
        <label className="novel-set-hint">
          <input
            checked={draft.trusted}
            disabled={busy}
            onChange={(event) => setDraft({ ...draft, trusted: event.currentTarget.checked })}
            type="checkbox"
          />{" "}
          信任（免审批）
        </label>
        <span style={{ flex: 1 }} />
        {draft.id !== undefined ? (
          <button
            className="novel-set-btn"
            disabled={busy || testing}
            onClick={() => {
              setDraft(emptyDraft());
              setTestResult(undefined);
              setStatus("已取消编辑");
            }}
            type="button"
          >
            <X size={12} aria-hidden />
            取消编辑
          </button>
        ) : null}
        {configuration.testMcp !== undefined ? (
          <button className="novel-set-btn" disabled={busy || testing} onClick={() => void testDraft()} type="button">
            <PlugZap size={12} aria-hidden />
            {testing ? "测试中…" : "测试连接"}
          </button>
        ) : null}
        <button className="novel-set-btn primary" disabled={busy || testing} onClick={() => void save()} type="button">
          <Check size={12} aria-hidden />
          {busy ? "保存中…" : "保存"}
        </button>
      </div>

      <p className="novel-set-hint">
        stdio 示例：命令 <code>npx</code>，参数 <code>-y @modelcontextprotocol/server-memory</code>（npx
        = 临时下载并运行该 npm 包）；http 示例：<code>https://mcp.example.com/mcp</code>。
      </p>

      {testResult?.ok === true ? (
        <div className="novel-set-section">
          <b>工具预览（{testResult.toolCount}）</b>
          <small>该服务器提供的外部工具</small>
        </div>
      ) : null}
      {testResult?.ok === true
        ? testResult.tools.map((tool) => (
            <p className="novel-set-hint" key={tool.name}>
              <code>{tool.name}</code>
              {tool.description !== undefined ? ` — ${tool.description}` : null}
            </p>
          ))
        : null}

      <p className="novel-provider-security-note" role="status">
        {status}
      </p>
    </section>
  );
}
