"""单人配对人工标注表：同一大纲的"原文窗 vs AI 扩写窗"并排，浏览器勾选 + 一键导出 labels.jsonl。

自包含 HTML（无网络无服务）：顶部 8 标签定义/边界卡（可折叠），每章若干配对块，
两栏各带 段落×8 复选框 + 证据输入（格式 `key:摘抄；key:摘抄`）+ 全零快捷键；
底部"导出 labels.jsonl"按钮在本地生成与 annotate.py 同构的记录（annotator:"human"）。
"""

from __future__ import annotations

import argparse
import html
import json
from pathlib import Path

from .labels import LABELS_VERSION, PROSE_GATE_LABELS

SHORT_LABELS = {
	"clicheExpression": "套话",
	"idiomStack": "四字",
	"adjPile": "修饰",
	"uniformSyntax": "同构",
	"explainTelling": "解说",
	"genericMetaphor": "空喻",
	"vagueSpecificity": "空泛",
	"flatAffect": "平直",
}
# 标签胶囊配色（与嵌入 JSON 一起下发到前端）
LABEL_COLORS = {
	"clicheExpression": "#c2410c",
	"idiomStack": "#a16207",
	"adjPile": "#be185d",
	"uniformSyntax": "#4338ca",
	"explainTelling": "#0e7490",
	"genericMetaphor": "#7c3aed",
	"vagueSpecificity": "#047857",
	"flatAffect": "#b91c1c",
}
SHEET_VERSION = "pair-v2"

_LABELS_JSON = json.dumps(
	[
		{
			"key": d.key,
			"label": d.label,
			"short": SHORT_LABELS[d.key],
			"color": LABEL_COLORS[d.key],
			"rubric": d.rubric,
			"boundary": d.boundary,
		}
		for d in PROSE_GATE_LABELS
	],
	ensure_ascii=False,
)

# 标注页共享样式（单花括号纯文本，经 {css} 注入模板——勿用 .format 处理本常量本身）
_SHEET_CSS = """ :root{--bg:#eef1f6;--card:#fff;--ink:#1c2430;--muted:#69758a;--line:#e3e8f0;
 --orig:#0b7a4b;--ai:#2456c4;--origbg:#f2f9f5;--aibg:#f1f5fd;--accent:#2456c4;--warn:#b45309}
 *{box-sizing:border-box}
 body{margin:0;background:var(--bg);color:var(--ink);
  font:15px/1.9 system-ui,"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif}
 .bar{position:sticky;top:0;z-index:20;display:flex;justify-content:space-between;align-items:center;gap:16px;
  padding:12px 28px;background:rgba(255,255,255,.94);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
 .bar h1{font-size:18px;margin:0;letter-spacing:.3px} .bar p{margin:2px 0 0;font-size:12.5px;color:var(--muted)}
 .bar-right{display:flex;align-items:center;gap:12px}
 .prog{font-size:13px;color:var(--muted);background:#f2f5fa;border:1px solid var(--line);border-radius:999px;padding:4px 14px;white-space:nowrap}
 button.exportbtn{border:0;background:var(--accent);color:#fff;font-size:14px;font-weight:600;
  padding:9px 20px;border-radius:10px;cursor:pointer;box-shadow:0 2px 10px rgba(36,86,196,.28)}
 button.exportbtn:hover{filter:brightness(1.07)}
 .legend{margin:20px auto 6px;max-width:1440px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 20px}
 .legend summary{cursor:pointer;font-weight:600;font-size:14px}
 .lb{margin:7px 0;font-size:13.5px;color:#39445a} .lb i{color:var(--muted)}
 .dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin:0 6px 0 2px}
 main{max-width:1440px;margin:0 auto;padding:4px 24px 90px}
 h2{font-size:14px;font-weight:700;color:var(--muted);margin:34px 4px 10px;letter-spacing:1px}
 .pair{display:none;background:var(--card);border:1px solid var(--line);border-radius:16px;
  box-shadow:0 1px 3px rgba(28,36,48,.05);padding:16px 18px;margin:14px 0}
 .pair.cur{display:block}
 .pair>h3{margin:0 0 12px;font-size:12.5px;font-weight:700;color:var(--muted);letter-spacing:.5px}
 .doneflag{color:var(--orig);margin-left:10px;font-weight:700}
 .flaggedflag{color:var(--warn);margin-left:6px;font-weight:700}
 .cols{display:flex;gap:16px;align-items:flex-start}
 .col{flex:1 1 0;min-width:0;border-radius:12px;padding:10px 12px}
 .col.orig{background:var(--origbg);border:1px solid #d5e9dd}
 .col.ai{background:var(--aibg);border:1px solid #d7e2f8}
 .colhead{display:flex;align-items:center;gap:8px;font-weight:700;font-size:13.5px;margin:2px 0 8px}
 .badge{font-size:11.5px;font-weight:700;color:#fff;border-radius:999px;padding:2px 11px;letter-spacing:1px}
 .orig .badge{background:var(--orig)} .ai .badge{background:var(--ai)}
 .colhead code{font-size:11px;color:var(--muted);font-weight:400;overflow:hidden;text-overflow:ellipsis}
 .zero{margin-left:auto;border:1px solid var(--line);background:#fff;color:var(--muted);
  font-size:12px;border-radius:8px;padding:3px 10px;cursor:pointer}
 .zero:hover{color:var(--ink);border-color:#c6cfdd}
 table{width:100%;border-collapse:collapse}
 td{border-top:1px dashed var(--line);padding:7px 6px;vertical-align:top}
 tr:first-child td{border-top:0}
 .pn{width:26px;color:#9aa5b8;font-size:12px;text-align:right;padding-top:9px}
 .pt{width:44%;font-size:14.5px}
 .pc{white-space:nowrap}
 .chip{display:inline-flex;margin:2px 3px 2px 0;cursor:pointer;-webkit-user-select:none;user-select:none}
 .chip input{position:absolute;opacity:0;pointer-events:none}
 .chip span{border:1.5px solid var(--c);color:var(--c);border-radius:999px;padding:1px 10px;
  font-size:12.5px;line-height:1.75;transition:background .12s,color .12s,filter .12s}
 .chip:hover span{filter:brightness(.92)}
 .chip input:checked+span{background:var(--c);color:#fff;font-weight:600}
 .ev td{border-top:0;padding-top:0}
 .evc{font-size:12px;color:var(--muted)}
 .evc input{width:92%;border:0;border-bottom:1px dashed #c9d2e0;background:transparent;
  font-size:12.5px;color:var(--ink);padding:3px 2px;outline:none}
 .evc input:focus{border-bottom:1.5px solid var(--accent)}
 .evc input.missing{border-bottom:2px solid #d64545}
 .nav{position:sticky;bottom:0;z-index:20;display:flex;gap:10px;align-items:center;justify-content:center;
  padding:10px 16px;background:rgba(255,255,255,.95);backdrop-filter:blur(8px);border-top:1px solid var(--line)}
 .nav button{border:1px solid var(--line);background:#fff;border-radius:10px;padding:8px 18px;
  font-size:14px;cursor:pointer;color:var(--ink)}
 .nav button:hover{border-color:#c6cfdd}
 .nav .primary{background:var(--accent);color:#fff;border:0;font-weight:600;box-shadow:0 2px 10px rgba(36,86,196,.28)}
 .nav .cnt{font-size:13px;color:var(--muted);min-width:110px;text-align:center}
 .nav .on{border-color:var(--warn);color:var(--warn);font-weight:700}
 .grid{display:none;position:fixed;left:0;right:0;bottom:58px;margin:0 auto;max-width:1440px;
  background:#fff;border:1px solid var(--line);border-radius:14px;padding:14px;z-index:30;
  flex-wrap:wrap;gap:6px;box-shadow:0 -4px 24px rgba(28,36,48,.12)}
 .grid.open{display:flex}
 .grid button{width:36px;height:30px;border:1px solid var(--line);background:#fff;border-radius:7px;
  font-size:12px;cursor:pointer;color:var(--muted)}
 .grid button.done{background:var(--orig);border-color:var(--orig);color:#fff}
 .grid button.flagged{outline:2px dashed var(--warn);outline-offset:1px}
 .grid button.curc{outline:2px solid var(--accent);outline-offset:1px}
 .stats{font-size:12px;color:var(--muted);background:#f2f5fa;border:1px solid var(--line);
  border-radius:999px;padding:4px 12px;white-space:nowrap}
 @media (max-width:1100px){.cols{flex-direction:column}.pt{width:auto}}
"""

# 存储层两种模式（format 值，单花括号安全注入）：local=file://localStorage；server=工作台 API
_STORAGE_SNIPPETS: dict[str, dict[str, str]] = {
	"local": {
		"loadStore": (
			"try { store = JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); }\n"
			"catch (e) { storageOk = false; "
			"alert('浏览器禁用了本地存储：进度无法持久化，请每窗标完及时导出。'); }"
		),
		"persist": (
			"if (storageOk) try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) {}"
		),
	},
	"server": {
		"loadStore": "store = await (await fetch('/api/labels/' + SCOPE)).json();",
		"persist": (
			"try { const r = await fetch('/api/save/' + SCOPE, {method: 'POST', "
			"headers: {'Content-Type': 'application/json'}, body: JSON.stringify(recs)}); "
			"if (!r.ok) alert('保存失败 HTTP ' + r.status); } "
			"catch (e) { alert('保存到服务器失败：' + e); }"
		),
	},
}


def load_windows_by_chapter(path: Path, source: str) -> dict[int, list[dict]]:
	by_chapter: dict[int, list[dict]] = {}
	with open(path, encoding="utf-8") as fh:
		for line in fh:
			if not line.strip():
				continue
			rec = json.loads(line)
			if rec.get("source") != source:
				continue
			by_chapter.setdefault(int(rec["chapterNo"]), []).append(rec)
	return by_chapter


def generate_sheet_html(
	original: dict[int, list[dict]],
	ai_expanded: dict[int, list[dict]],
	title: str = "prose-gate 配对标注表",
	mode: str = "local",
	scope: str = "sheet",
) -> tuple[str, int]:
	"""按章配对（索引对齐）构建标注页 HTML；返回 (html, 配对窗总数)。

	mode：local=file://localStorage 离线单文件；server=工作台 API（snippet 见 _STORAGE_SNIPPETS）。
	scope：server 模式的标注域（书 alias 或 gen id），对应 /api/labels/<scope>。
	"""
	chapters = sorted(set(original) & set(ai_expanded))
	pairs_total = 0
	sections: list[str] = []
	for no in chapters:
		blocks: list[str] = []
		for idx, (orig, ai) in enumerate(zip(original[no], ai_expanded[no])):
			pairs_total += 1
			blocks.append(_PAIR_BLOCK.format(
				seq=idx + 1,
				orig_id=html.escape(orig["windowId"]),
				ai_id=html.escape(ai["windowId"]),
				orig_book=html.escape(orig["bookId"]),
				ai_book=html.escape(ai["bookId"]),
				chapter=no,
				orig_paras=_render_paras(orig["texts"], "o"),
				ai_paras=_render_paras(ai["texts"], "a"),
			))
		sections.append(f'<h2>第 {no} 章</h2>\n' + "\n".join(blocks))

	if mode not in _STORAGE_SNIPPETS:
		raise ValueError(f"未知存储模式：{mode}")
	page = _PAGE.format(
		title=html.escape(title),
		pairs=pairs_total,
		body="\n".join(sections),
		labels=_LABELS_JSON,
		labelsVersion=LABELS_VERSION,
		sheetVersion=SHEET_VERSION,
		css=_SHEET_CSS,
		scope=html.escape(scope),
		**_STORAGE_SNIPPETS[mode],
	)
	return page, pairs_total


def generate_sheet(
	original: dict[int, list[dict]],
	ai_expanded: dict[int, list[dict]],
	out_path: Path,
	title: str = "prose-gate 配对标注表",
	mode: str = "local",
	scope: str = "sheet",
) -> int:
	"""写出自包含标注表 HTML；返回配对窗总数。"""
	page, pairs_total = generate_sheet_html(original, ai_expanded, title=title, mode=mode, scope=scope)
	out_path.parent.mkdir(parents=True, exist_ok=True)
	out_path.write_text(page, encoding="utf-8")
	return pairs_total


def _render_paras(texts: list[str], prefix: str) -> str:
	rows = []
	for i, text in enumerate(texts, start=1):
		chips = "".join(
			f'<label class="chip" style="--c:{LABEL_COLORS[d.key]}" title="{html.escape(d.rubric)}">'
			f'<input type="checkbox" data-w="{prefix}W" data-p="{i - 1}" data-k="{d.key}">'
			f"<span>{html.escape(SHORT_LABELS[d.key])}</span></label>"
			for d in PROSE_GATE_LABELS
		)
		rows.append(
			f'<tr><td class="pn">{i}</td><td class="pt">{html.escape(text)}</td>'
			f'<td class="pc">{chips}</td></tr>'
			f'<tr class="ev"><td></td><td colspan="2" class="evc">'
			f'<input type="text" data-w="{prefix}W" data-p="{i - 1}" placeholder="证据（判 1 必填）格式 key:原文摘抄；key:原文摘抄"></td></tr>'
		)
	return "\n".join(rows)


_PAIR_BLOCK = """<section class="pair" data-orig="{orig_id}" data-ai="{ai_id}" data-orig-book="{orig_book}" data-ai-book="{ai_book}" data-chapter="{chapter}">
  <h3>配对窗 {seq} · 第 {chapter} 章</h3>
  <div class="cols">
    <div class="col orig"><div class="colhead"><span class="badge">原文</span><code>{orig_id}</code><button type="button" class="zero">全零</button></div>
      <table><tbody>
{orig_paras}
      </tbody></table></div>
    <div class="col ai"><div class="colhead"><span class="badge">AI 扩写</span><code>{ai_id}</code><button type="button" class="zero">全零</button></div>
      <table><tbody>
{ai_paras}
      </tbody></table></div>
  </div>
</section>"""

_PAGE = """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>{css}</style></head><body>
<header class="bar">
  <div><h1>{title}</h1><p>{pairs} 配对窗 · 逐窗标注：勾选 → 补证据 → 保存并下一窗（自动存本地，刷新不丢）· 相对性标签先看整栏节奏</p></div>
  <div class="bar-right"><span id="stats" class="stats">–</span><span id="prog" class="prog">0/{pairs}</span><button id="export" class="exportbtn" type="button">导出 labels.jsonl</button></div>
</header>
<details open class="legend"><summary>8 标签判定标准与边界（点击折叠 · 建议随手对照）</summary><div id="labels"></div></details>
<main id="pairs">
{body}
</main>
<div id="grid" class="grid"></div>
<nav class="nav">
  <button id="prev" type="button">‹ 上一窗</button>
  <button id="skip" type="button">跳过</button>
  <button id="gridToggle" type="button">☰ 概览</button>
  <span class="cnt" id="cnt"></span>
  <button id="flag" type="button">⚑ 存疑</button>
  <button id="next" class="primary" type="button">保存并下一窗 ›</button>
</nav>
<pre id="out" style="display:none"></pre>
<script>
const LABELS = {labels};
const labelsVersion = "{labelsVersion}";
const STORE_KEY = 'prose-gate-sheet:' + document.title;
const SCOPE = "{scope}";
document.getElementById('labels').innerHTML = LABELS.map(d =>
  `<div class="lb"><span class="dot" style="background:${{d.color}}"></span><b>${{d.short}}（${{d.key}}）</b> ${{d.rubric}} <i>边界：${{d.boundary}}</i></div>`).join('');

const pairs = Array.from(document.querySelectorAll('.pair'));
let store = {{}};
let storageOk = true;
async function loadStore() {{ {loadStore} }}
async function persistStore(recs) {{ {persist} }}

document.querySelectorAll('.pair .zero').forEach(btn => btn.addEventListener('click', () => {{
  btn.closest('.col').querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false);
  btn.closest('.col').querySelectorAll('input[type=text]').forEach(t => t.value = '');
  upd();
}}));

function collect(col, windowId, bookId, chapterNo) {{
  const n = col.querySelectorAll('td.pn').length;
  const labels = [], evidence = [];
  const evInputs = col.querySelectorAll('input[type=text]');
  const evMap = {{}};
  evInputs.forEach(inp => {{
    const p = parseInt(inp.dataset.p, 10);
    inp.value.split(/[；;]/).filter(s => s.trim()).forEach(part => {{
      const m = part.match(/^\\s*([a-zA-Z]+)\\s*[：:]\\s*(.+)$/);
      if (m) (evMap[p] = evMap[p] || {{}})[m[1]] = m[2].trim();
    }});
  }});
  for (let i = 0; i < n; i++) {{
    const row = {{}};
    col.querySelectorAll(`input[type=checkbox][data-p="${{i}}"]`).forEach(cb => row[cb.dataset.k] = cb.checked ? 1 : 0);
    labels.push(row); evidence.push(evMap[i] || {{}});
  }}
  return {{windowId, bookId, chapterNo, labels, evidence, other: [], errors: [],
    meta: {{annotator: "human", labelsVersion: "{labelsVersion}", sheetVersion: "{sheetVersion}",
      annotatedAt: new Date().toISOString()}}}};
}}

function pairRecords(pair) {{
  const cols = pair.querySelectorAll('.col');
  return [
    collect(cols[0], pair.dataset.orig, pair.dataset.origBook, parseInt(pair.dataset.chapter, 10)),
    collect(cols[1], pair.dataset.ai, pair.dataset.aiBook, parseInt(pair.dataset.chapter, 10))
  ];
}}

function findMissingEvidence(pair) {{
  const missing = [];
  pair.querySelectorAll('.col').forEach(col => {{
    col.querySelectorAll('.chip input:checked').forEach(cb => {{
      const p = cb.dataset.p, k = cb.dataset.k;
      const inp = col.querySelector(`input[type=text][data-p="${{p}}"]`);
      const hit = inp && inp.value.match(new RegExp(k + '\\\\s*[：:]'));
      inp.classList.toggle('missing', !hit);
      if (!hit) missing.push({{col, p, key: k}});
    }});
  }});
  return missing;
}}

async function saveCurrent(silent) {{
  const pair = pairs[cur];
  let missing = findMissingEvidence(pair);
  if (missing.length && !silent) {{
    const ok = confirm(missing.length + ' 处判 1 缺证据摘抄。\\n「确定」= 保存并将缺失判分作废（记 0）；「取消」= 留在本窗补证据。');
    if (!ok) return false;
  }}
  // 缺证据的判分作废（取消勾选后落库记 0），与 LLM 标注的证据硬校验同构
  missing.forEach(m => {{
    const cb = m.col.querySelector(`input[type=checkbox][data-p="${{m.p}}"][data-k="${{m.key}}"]`);
    if (cb) cb.checked = false;
  }});
  const recs = pairRecords(pair);
  recs.forEach(rec => {{ if (pendingFlag) rec.flag = true; store[rec.windowId] = rec; }});
  await persistStore(recs);
  setPendingFlag(false);
  pair.classList.add('done');
  const h3 = pair.querySelector('h3');
  if (!h3.querySelector('.doneflag')) h3.insertAdjacentHTML('beforeend', '<span class="doneflag">✓ 已保存</span>');
  syncGrid(); upd();
  return true;
}}

function restore(pair) {{
  [pair.dataset.orig, pair.dataset.ai].forEach((wid, ci) => {{
    const rec = store[wid], col = pair.querySelectorAll('.col')[ci];
    col.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false);
    col.querySelectorAll('input[type=text]').forEach(t => t.value = '');
    if (!rec) return;
    rec.labels.forEach((row, i) => Object.keys(row).forEach(k => {{
      if (row[k] === 1) {{
        const cb = col.querySelector(`input[type=checkbox][data-p="${{i}}"][data-k="${{k}}"]`);
        if (cb) cb.checked = true;
      }}
    }}));
    rec.evidence.forEach((ev, i) => {{
      const text = Object.keys(ev).map(k => k + ':' + ev[k]).join('；');
      if (text) {{ const inp = col.querySelector(`input[type=text][data-p="${{i}}"]`); if (inp) inp.value = text; }}
    }});
  }});
}}

let cur = 0;
let pendingFlag = false;
function setPendingFlag(v) {{
  pendingFlag = v;
  document.getElementById('flag').classList.toggle('on', v);
}}
function currentFlagged() {{
  const p = pairs[cur];
  const rec = store[p.dataset.orig];
  return !!(rec && rec.flag);
}}
function show(i) {{
  cur = Math.max(0, Math.min(pairs.length - 1, i));
  pairs.forEach((p, idx) => p.classList.toggle('cur', idx === cur));
  restore(pairs[cur]);
  setPendingFlag(currentFlagged());
  document.getElementById('cnt').textContent = (cur + 1) + '/' + pairs.length + (isDone(pairs[cur]) ? ' ✓' : '');
  document.querySelector('main').scrollIntoView({{behavior: 'instant', block: 'start'}});
  syncGrid();
}}
function isDone(pair) {{
  return !!store[pair.dataset.orig] && !!store[pair.dataset.ai];
}}
function upd() {{
  const done = pairs.filter(isDone).length;
  document.getElementById('prog').textContent = done + '/' + pairs.length;
  // 标签命中统计（已保存记录聚合，标注时看缺陷画像成形）
  const hits = {{}};
  LABELS.forEach(d => hits[d.key] = 0);
  Object.values(store).forEach(rec => rec.labels.forEach(row =>
    Object.keys(row).forEach(k => {{ if (row[k] === 1) hits[k] = (hits[k] || 0) + 1; }})));
  document.getElementById('stats').textContent = LABELS.map(d => d.short + ' ' + (hits[d.key] || 0)).join(' · ');
}}
function syncGrid() {{
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  pairs.forEach((p, idx) => {{
    const b = document.createElement('button');
    b.textContent = idx + 1;
    if (isDone(p)) b.classList.add('done');
    const rec = store[p.dataset.orig];
    if (rec && rec.flag) b.classList.add('flagged');
    if (idx === cur) b.classList.add('curc');
    b.addEventListener('click', () => {{ grid.classList.remove('open'); show(idx); }});
    grid.appendChild(b);
  }});
}}
document.getElementById('prev').addEventListener('click', () => show(cur - 1));
document.getElementById('skip').addEventListener('click', () => show(cur + 1));
document.getElementById('flag').addEventListener('click', () => setPendingFlag(!pendingFlag));
document.getElementById('next').addEventListener('click', async () => {{
  if (!(await saveCurrent(false))) return;
  show(cur + 1);
}});
document.getElementById('gridToggle').addEventListener('click', () => document.getElementById('grid').classList.toggle('open'));
document.addEventListener('change', e => {{
  if (e.target.matches('.chip input')) {{
    e.target.closest('.col').querySelectorAll('.evc input').forEach(t => t.classList.remove('missing'));
    upd();
  }}
}});
async function doExport() {{
  await saveCurrent(true);  // 当前窗先落库再导出（不弹缺证据确认，缺的作废）
  const lines = pairs.flatMap(p => pairRecords(p))
    .filter(rec => store[rec.windowId])
    .map(rec => JSON.stringify(store[rec.windowId], ensureAsciiReplacer));
  if (!lines.length) {{ alert('还没有已保存的标注。'); return; }}
  const text = lines.join('\\n');
  const blob = new Blob([text], {{type: 'application/jsonl'}});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'labels-human.jsonl'; a.click();
  return navigator.clipboard.writeText(text)
    .then(() => alert('已导出 ' + lines.length + ' 条窗口记录（并复制到剪贴板）'))
    .catch(() => alert('已导出 ' + lines.length + ' 条窗口记录'));
}}
document.querySelectorAll('button.exportbtn').forEach(btn => btn.addEventListener('click', () => doExport()));
function ensureAsciiReplacer(k, v) {{ return v; }}

// 初始化：载入已存标注 → 恢复完成态 → 跳到第一个未保存窗（已标的不再重复标）
(async function init() {{
  await loadStore();
  pairs.forEach(p => {{ if (isDone(p)) p.classList.add('done'); }});
  syncGrid(); upd();
  const firstUnsaved = pairs.findIndex(p => !isDone(p));
  show(firstUnsaved === -1 ? 0 : firstUnsaved);
}})();
</script></body></html>"""


def main(argv: list[str] | None = None) -> int:
	parser = argparse.ArgumentParser(description="生成配对人工标注表 HTML")
	parser.add_argument("--original", type=Path, default=Path("artifacts/windows.jsonl"))
	parser.add_argument("--ai", type=Path, default=Path("artifacts/ai-windows.jsonl"))
	parser.add_argument("--out", type=Path, default=Path("artifacts/annotation-sheet.html"))
	parser.add_argument("--chapters", default=None, help="逗号分隔章号，缺省两池交集全部")
	parser.add_argument("--title", default="prose-gate 配对标注表")
	args = parser.parse_args(argv)

	original = load_windows_by_chapter(args.original, source="book")
	ai_expanded = load_windows_by_chapter(args.ai, source="ai-expanded")
	if args.chapters:
		wanted = {int(c) for c in args.chapters.split(",")}
		original = {no: v for no, v in original.items() if no in wanted}
		ai_expanded = {no: v for no, v in ai_expanded.items() if no in wanted}
	pairs = generate_sheet(original, ai_expanded, args.out, title=args.title)
	print(f"配对标注表 → {args.out}（{pairs} 配对窗）")
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
