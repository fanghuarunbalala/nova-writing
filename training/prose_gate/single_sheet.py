"""单栏标注页：独立生成的 AI 文本（题目注入，无原文对照）逐窗标注。

与 sheet.py 共享样式/胶囊渲染/存储片段，仅交互差异：每窗一条记录（无对照栏），
适配"独立为主，可选配对照"里的独立形态（贴近生产门控场景：判裸生成物）。
"""

from __future__ import annotations

import html
from pathlib import Path

from .labels import LABELS_VERSION
from .sheet import (
	_LABELS_JSON,
	_SHEET_CSS,
	_STORAGE_SNIPPETS,
	_render_paras,
)

SINGLE_SHEET_VERSION = "single-v1"

_SINGLE_BLOCK = """<section class="pair" data-orig="{wid}" data-orig-book="{book}" data-chapter="{chapter}">
  <h3>窗 {seq}</h3>
  <div class="cols">
    <div class="col ai"><div class="colhead"><span class="badge">AI 生成</span><code>{wid}</code><button type="button" class="zero">全零</button></div>
      <table><tbody>
{paras}
      </tbody></table></div>
  </div>
</section>"""

_PAGE = """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>{css}</style></head><body>
<header class="bar">
  <div><h1>{title}</h1><p>{pairs} 窗独立标注（无对照）· 判 1 必填证据摘抄（key:摘抄；key:摘抄）· ⚑ 存疑可稍后复查</p></div>
  <div class="bar-right"><span id="stats" class="stats">–</span><span id="prog" class="prog">0/{pairs}</span><button id="export" class="exportbtn" type="button">导出备份</button></div>
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
<script>
const LABELS = {labels};
const labelsVersion = "{labelsVersion}";
const SCOPE = "{scope}";
const STORE_KEY = 'prose-gate-single:' + document.title;
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
  const evMap = {{}};
  col.querySelectorAll('input[type=text]').forEach(inp => {{
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
  const col = pair.querySelector('.col');
  return [collect(col, pair.dataset.orig, pair.dataset.origBook, parseInt(pair.dataset.chapter, 10))];
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
  const missing = findMissingEvidence(pair);
  if (missing.length && !silent) {{
    const ok = confirm(missing.length + ' 处判 1 缺证据摘抄。\\n「确定」= 保存并将缺失判分作废（记 0）；「取消」= 留在本窗补证据。');
    if (!ok) return false;
  }}
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
  const rec = store[pair.dataset.orig], col = pair.querySelector('.col');
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
}}

let cur = 0;
let pendingFlag = false;
function setPendingFlag(v) {{
  pendingFlag = v;
  document.getElementById('flag').classList.toggle('on', v);
}}
function currentFlagged() {{
  const rec = store[pairs[cur].dataset.orig];
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
function isDone(pair) {{ return !!store[pair.dataset.orig]; }}
function upd() {{
  const done = pairs.filter(isDone).length;
  document.getElementById('prog').textContent = done + '/' + pairs.length;
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
  await saveCurrent(true);
  const lines = pairs.flatMap(p => pairRecords(p))
    .filter(rec => store[rec.windowId])
    .map(rec => JSON.stringify(store[rec.windowId], ensureAsciiReplacer));
  if (!lines.length) {{ alert('还没有已保存的标注。'); return; }}
  const text = lines.join('\\n');
  const blob = new Blob([text], {{type: 'application/jsonl'}});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'labels-backup.jsonl'; a.click();
  return navigator.clipboard.writeText(text)
    .then(() => alert('已导出 ' + lines.length + ' 条记录备份'))
    .catch(() => alert('已导出 ' + lines.length + ' 条记录备份'));
}}
document.querySelectorAll('button.exportbtn').forEach(btn => btn.addEventListener('click', () => doExport()));
function ensureAsciiReplacer(k, v) {{ return v; }}

(async function init() {{
  await loadStore();
  pairs.forEach(p => {{ if (isDone(p)) p.classList.add('done'); }});
  syncGrid(); upd();
  const firstUnsaved = pairs.findIndex(p => !isDone(p));
  show(firstUnsaved === -1 ? 0 : firstUnsaved);
}})();
</script></body></html>"""


def generate_single_html(
	records: list[dict],
	title: str = "prose-gate 独立标注",
	mode: str = "server",
	scope: str = "gen",
) -> tuple[str, int]:
	"""AI 生成窗口记录列表 → 单栏标注页 HTML；返回 (html, 窗数)。"""
	sections: list[str] = []
	for idx, rec in enumerate(records):
		sections.append(
			_SINGLE_BLOCK.format(
				seq=idx + 1,
				wid=html.escape(rec["windowId"]),
				book=html.escape(rec["bookId"]),
				chapter=int(rec.get("chapterNo", 1)),
				paras=_render_paras(rec["texts"], "o"),
			)
		)
	if mode not in _STORAGE_SNIPPETS:
		raise ValueError(f"未知存储模式：{mode}")
	page = _PAGE.format(
		title=html.escape(title),
		pairs=len(records),
		body="\n".join(sections),
		labels=_LABELS_JSON,
		labelsVersion=LABELS_VERSION,
		sheetVersion=SINGLE_SHEET_VERSION,
		css=_SHEET_CSS,
		scope=html.escape(scope),
		**_STORAGE_SNIPPETS[mode],
	)
	return page, len(records)


def generate_single_sheet(
	records: list[dict],
	out_path: Path,
	title: str = "prose-gate 独立标注",
	mode: str = "local",
	scope: str = "gen",
) -> int:
	page, count = generate_single_html(records, title=title, mode=mode, scope=scope)
	out_path.parent.mkdir(parents=True, exist_ok=True)
	out_path.write_text(page, encoding="utf-8")
	return count
