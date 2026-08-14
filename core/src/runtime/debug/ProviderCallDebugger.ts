import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProviderCall, LLMessage, ToolScheme } from "../provider/types.js";

/**
 * ProviderCall 调试器：记录每次请求与相邻差异。
 * 输出以 conversation/agent 为单位区分（dir 由上层拼好路径），jsonl + html（默认展示），debug 开启。
 * html：初次请求展示完整 system（markdown）/tools/messages；后续展示各字段 diff。
 */
export class ProviderCallDebugger {
  /** 是否启用 */
  private readonly enabled: boolean;
  /** jsonl 输出路径（每行一个 request） */
  private readonly jsonlPath: string;
  /** html 输出路径（默认展示） */
  private readonly htmlPath: string;
  /** 已记录请求序列 */
  private readonly requests: ProviderCall[] = [];

  /**
   * 构造 ProviderCallDebugger
   * @param opts 开关 + 输出目录（上层按 conversation/agent 拼好，如 debug/<convId>/<agentId>/）
   */
  constructor(opts: { enabled: boolean; dir: string }) {
    this.enabled = opts.enabled;
    this.jsonlPath = join(opts.dir, "provider-calls.jsonl");
    this.htmlPath = join(opts.dir, "provider-calls.html");
    if (this.enabled) {
      mkdirSync(opts.dir, { recursive: true });
    }
  }

  /**
   * 记录一次请求（追加 jsonl；html 在 close 时渲染）
   * @param call ProviderCall
   */
  record(call: ProviderCall): void {
    if (!this.enabled) return;
    this.requests.push(call);
    appendFileSync(this.jsonlPath, `${JSON.stringify(call)}\n`);
  }

  /** 关闭：渲染并写最终 html */
  close(): void {
    if (!this.enabled) return;
    writeFileSync(this.htmlPath, this.renderHtml());
  }

  /** 渲染 html：初次请求完整展示，后续展示相邻差异 */
  private renderHtml(): string {
    const rows: string[] = [];
    for (let i = 0; i < this.requests.length; i++) {
      const call = this.requests[i]!;
      rows.push(i === 0 ? this.renderFirst(call) : this.renderDiff(this.requests[i - 1]!, call, i + 1));
    }
    return `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>Provider Calls</title>
<style>
:root{--bg:#ffffff;--card:#f6f8fa;--border:#d8dee4;--text:#1f2328;--muted:#57606a;--accent:#0969da;--hl:#9a6700;--add-bg:#ccffd8;--add-border:#1a7f37;--add-text:#116329;--del-bg:#ffeef0;--del-border:#cf222e;--del-text:#cf222e}
body{font-family:-apple-system,Segoe UI,Roboto,Noto Sans SC,sans-serif;background:var(--bg);color:var(--text);margin:0;padding:16px;line-height:1.6}
h1{color:var(--accent)} h2{font-size:1.1em} h3{margin:0 0 8px;color:var(--accent)} h4{margin:12px 0 4px;color:#0a3069}
.req{border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin:12px 0;background:var(--card)}
.muted{color:var(--muted)} .changed{color:var(--hl)}
.add{display:block;background:var(--add-bg);border-left:4px solid var(--add-border);padding:2px 8px;margin:2px 0;border-radius:4px;color:var(--add-text)}
.del{display:block;background:var(--del-bg);border-left:4px solid var(--del-border);padding:2px 8px;margin:2px 0;border-radius:4px;color:var(--del-text)}
.md h2,.md h3,.md h4{color:#0a3069;margin:.5em 0 .2em}.md code{background:#f1f3f5;padding:1px 5px;border-radius:4px;font-size:.92em;color:#116329}
.md pre{background:#f6f8fa;padding:8px 12px;border-radius:6px;overflow-x:auto;border:1px solid var(--border)}
.md li{margin:2px 0}.md p{margin:.4em 0}
.badge{display:inline-block;padding:1px 8px;border-radius:10px;font-size:.78em;margin-right:6px;vertical-align:middle}
.b-user{background:#ddf4ff;color:#0550ae}.b-assistant{background:#dafbe1;color:#116329}.b-tool{background:#fff1e5;color:#bc4c00}.b-system{background:#fbefff;color:#8250df}
.msg{margin:6px 0;padding:6px 10px;border-left:3px solid var(--border);background:#fafbfc;border-radius:4px}
.msg .md{font-size:.95em}.tools{display:flex;flex-wrap:wrap;gap:8px}
.tool{border:1px solid var(--border);border-radius:6px;padding:6px 10px;background:#fafbfc;font-size:.85em}
pre{background:#f6f8fa;padding:8px 12px;border-radius:6px;overflow-x:auto;border:1px solid var(--border)}
</style></head><body>
<h1>Provider Calls</h1>
${rows.join("\n")}
</body></html>`;
  }

  /** 初次请求：完整展示 system（markdown）/tools/messages */
  private renderFirst(call: ProviderCall): string {
    return `<div class="req">
      <h3>#1 初次请求 · ${escapeHtml(call.sampling.model)}${call.sampling.maxTokens ? ` · maxTokens=${call.sampling.maxTokens}` : ""}</h3>
      <h4>System Prompt</h4><div class="md">${mdToHtml(call.system)}</div>
      <h4>Tool Schemes</h4><div class="tools">${call.tools ? call.tools.map(renderTool).join("") : '<span class="muted">（无）</span>'}</div>
      <h4>Messages</h4>${call.messages.map(renderMessage).join("") || '<span class="muted">（空）</span>'}
      <details><summary>完整请求 JSON</summary><pre>${escapeHtml(JSON.stringify(call, null, 2))}</pre></details>
    </div>`;
  }

  /** 后续请求：相邻差异（system diff / messages 新增 / tools / sampling） */
  private renderDiff(prev: ProviderCall, curr: ProviderCall, n: number): string {
    const sysDiff = diffLines(prev.system, curr.system);
    const addedMsgs = curr.messages.slice(prev.messages.length);
    const toolsChanged = JSON.stringify(prev.tools) !== JSON.stringify(curr.tools);
    const samplingChanged = JSON.stringify(prev.sampling) !== JSON.stringify(curr.sampling);
    return `<div class="req">
      <h3>#${n} 差异 · ${escapeHtml(curr.sampling.model)}</h3>
      <h4>System Diff</h4>
      ${sysDiff.removed.length || sysDiff.added.length
        ? `<div class="md">${sysDiff.removed.length ? `<div class="del">${mdToHtml(sysDiff.removed.join("\n"))}</div>` : ""}${sysDiff.added.length ? `<div class="add">${mdToHtml(sysDiff.added.join("\n"))}</div>` : ""}</div>`
        : '<span class="muted">不变</span>'}
      <h4>新增 Messages</h4>${addedMsgs.map(renderMessage).join("") || '<span class="muted">（无新增）</span>'}
      <h4>Tools</h4><span class="${toolsChanged ? "changed" : "muted"}">${toolsChanged ? "变化" : "不变"}</span>
      <h4>Sampling</h4><span class="${samplingChanged ? "changed" : "muted"}">${samplingChanged ? "变化" : "不变"}</span>
    </div>`;
  }
}

/** 渲染工具 scheme 卡片 */
function renderTool(tool: ToolScheme): string {
  return `<div class="tool"><strong>${escapeHtml(tool.name)}</strong>${tool.description ? ` — ${escapeHtml(tool.description)}` : ""}</div>`;
}

/** 渲染消息（role 徽章 + markdown 内容） */
function renderMessage(m: LLMessage): string {
  const toolCalls = m.role === "assistant" ? m.toolCalls : undefined;
  return `<div class="msg"><span class="badge b-${m.role}">${m.role}</span><div class="md">${mdToHtml(m.content)}</div>${toolCalls ? `<div class="muted">tool_calls: ${escapeHtml(JSON.stringify(toolCalls))}</div>` : ""}</div>`;
}

/** 简单行级 diff：a 有 b 无为 removed，b 有 a 无为 added */
function diffLines(prev: string, curr: string): { removed: string[]; added: string[] } {
  const a = prev.split("\n");
  const b = curr.split("\n");
  return {
    removed: a.filter((l) => !b.includes(l)),
    added: b.filter((l) => !a.includes(l)),
  };
}

/** 最小 markdown → HTML（标题/代码块/粗体/行内代码/列表/段落） */
function mdToHtml(md: string): string {
  let html = escapeHtml(md);
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, "<pre><code>$2</code></pre>");
  html = html.replace(/^#### (.*)$/gm, "<h4>$1</h4>");
  html = html.replace(/^### (.*)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.*)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.*)$/gm, "<h2>$1</h2>");
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/^- (.*)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>[\s\S]*?<\/li>)/g, (m) => `<ul>${m}</ul>`);
  html = html.replace(/\n{2,}/g, "</p><p>");
  return `<p>${html}</p>`;
}

/** HTML 转义 */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
