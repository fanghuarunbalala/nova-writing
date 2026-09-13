"""单栏标注页：独立生成的 AI 文本（题目注入，无原文对照）逐窗标注。

与 sheet.py 共享样式/卡片渲染/存储片段/主题与抽屉交互；差异：每窗一条记录、无两部分、
无概要卡（独立生成无原文窗与概要）。适配"独立为主"的裸生成物场景（贴近生产门控）。
"""

from __future__ import annotations

import html
from pathlib import Path

from .labels import FLAT_RANGE_MAX, LABELS_VERSION
from .sheet import (
	_EMOTION_JSON,
	_LABELS_JSON,
	_SHEET_CSS,
	_STORAGE_SNIPPETS,
	_render_paras,
)

SINGLE_SHEET_VERSION = "single-v4"

_SINGLE_BLOCK = """<section class="pair" data-orig="{wid}" data-orig-book="{book}" data-chapter="{chapter}">
  <h3>窗 {seq}</h3>
  <div class="col ai"><div class="colhead"><span class="badge">AI 生成</span><code>{wid}</code><button type="button" class="zero">全零</button></div>
{paras}
    <div class="otherrow"><input type="text" class="otherin" placeholder="其他（缺陷之外的问题，不判分，；分隔）——表层标点/逻辑跳跃/用词/角色腔随手记"></div>
  </div>
</section>"""

_PAGE = """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>{css}</style></head><body>
<header class="bar">
  <div><h1>{title}</h1><p>{pairs} 窗独立标注（无对照）· 每段判缺陷（判 1 补证据）+ 选情绪强度 0-3 · ⚑ 存疑可复查</p></div>
  <div class="bar-right"><span id="stats" class="stats">–</span><span id="prog" class="prog">0/{pairs}</span>
    <button id="export" class="exportbtn" type="button">导出 labels</button>
    <button class="theme" id="theme" type="button">🌙</button></div>
</header>
<details open class="legend"><summary>缺陷标签 + 情绪线档位（点击折叠 · 建议随手对照）</summary><div id="labels"></div></details>
<main id="pairs">
{body}
</main>
<div class="sheet" id="overviewSheet">
  <h2>概览 · {pairs} 窗<button class="close" type="button" onclick="closeSheets()">✕</button></h2>
  <div class="legend2">
    <span><span class="ldot" style="background:var(--orig)"></span>已保存 <i id="cDone"></i></span>
    <span><span class="ldot" style="outline:2px dashed var(--warn)"></span>存疑</span>
    <span><span class="ldot" style="border:1px solid var(--line)"></span>未标 <i id="cTodo"></i></span>
  </div>
  <div class="fchips">
    <button class="fchip on" type="button" onclick="filterGrid('all',this)">全部</button>
    <button class="fchip" type="button" onclick="filterGrid('flagged',this)">只看存疑</button>
    <button class="fchip" type="button" onclick="filterGrid('todo',this)">只看未标</button>
  </div>
  <div class="ggrid" id="ggrid"></div>
  <p>点击格子跳转该窗并关闭抽屉。</p>
</div>
<div class="sheet" id="exportSheet">
  <h2>导出 labels.jsonl<button class="close" type="button" onclick="closeSheets()">✕</button></h2>
  <div class="exstats" id="exstats"></div>
  <details><summary style="font-size:13px;cursor:pointer;color:var(--muted)">查看记录样例（与训练管线同构）</summary>
  <pre class="rec" id="exrec"></pre></details>
  <div class="btnrow">
    <button class="btn" type="button" onclick="doDownload()">下载 jsonl</button>
    <button class="btn ghost" type="button" onclick="doCopy()">复制到剪贴板</button>
  </div>
  <p>server 模式下标注实时落盘服务端，导出仅作备份与迁移用。</p>
</div>
<nav class="nav">
  <button id="prev" type="button">‹ 上一窗</button>
  <button id="skip" type="button">跳过</button>
  <button id="gridToggle" type="button">☰ 概览</button>
  <span class="cnt" id="cnt"></span>
  <button id="pre" type="button" title="LLM 预填本窗，人工只做校正">⚡ 预标</button>
  <button id="flag" type="button">⚑ 存疑</button>
  <button id="next" class="primary" type="button">保存并下一窗 ›</button>
</nav>
<div class="toast" id="toast"></div>
<script>
const LABELS = {labels};
const EMO = {emotion};
const labelsVersion = "{labelsVersion}";
const SCOPE = "{scope}";
const STORE_KEY = 'prose-gate-single:' + document.title;

const rootEl = document.documentElement, themeBtn = document.getElementById('theme');
if (localStorage.getItem('wb-theme') === 'dark') rootEl.dataset.theme = 'dark';
themeBtn.textContent = rootEl.dataset.theme === 'dark' ? '☀️' : '🌙';
themeBtn.addEventListener('click', () => {{
  rootEl.dataset.theme = rootEl.dataset.theme === 'dark' ? '' : 'dark';
  localStorage.setItem('wb-theme', rootEl.dataset.theme);
  themeBtn.textContent = rootEl.dataset.theme === 'dark' ? '☀️' : '🌙';
}});

document.getElementById('labels').innerHTML = LABELS.map(d =>
  `<div class="lb"><span style="color:${{d.color}}">●</span> <b>${{d.short}}（${{d.key}}）</b> ${{d.rubric}} <i>边界：${{d.boundary}}</i></div>`).join('')
  + `<div class="lb"><b>情绪线（每段必选，免证据）</b> ${{EMO.map(e => e.value + ' ' + e.name + '：' + e.anchor).join('；')}}<br><i>窗口平直（派生，不用标）= 全窗 max−min ≤ {flatRange}。</i></div>`;

const pairs = Array.from(document.querySelectorAll('.pair'));
let store = {{}};
let storageOk = true;
async function loadStore() {{ {loadStore} }}
async function persistStore(recs) {{ {persist} }}

document.querySelectorAll('.pair .zero').forEach(btn => btn.addEventListener('click', () => {{
  btn.closest('.col').querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false);
  btn.closest('.col').querySelectorAll('input[type=text][data-p]').forEach(t => t.value = '');
  upd();
}}));

// 勾选缺陷胶囊 → 证据自动填入该段整段原文（合法子串，删减即可）；已有该 key 则不动
document.addEventListener('change', e => {{
  if (!e.target.matches('.chip input') || !e.target.checked) return;
  const col = e.target.closest('.col');
  const p = e.target.dataset.p, k = e.target.dataset.k;
  const inp = col.querySelector(`input[type=text][data-p="${{p}}"]`);
  if (!inp || new RegExp(k + '\\\\s*[：:]').test(inp.value)) return;
  const cards = col.querySelectorAll('.pcard');
  const para = cards[parseInt(p, 10)].querySelector('.ptext').textContent.replace(/^\\d+\\.\\s*/, '');
  inp.value = inp.value ? (inp.value.replace(/[；;]\\s*$/, '') + '；' + k + ':' + para) : (k + ':' + para);
  inp.classList.remove('missing');
  const pc = cards[parseInt(p, 10)];
  if (pc) pc.classList.remove('needev');
}});

function collect(col, windowId, bookId, chapterNo) {{
  const n = col.querySelectorAll('.pcard').length;
  const labels = [], emotion = [], evidence = [];
  const evMap = {{}};
  col.querySelectorAll('input[type=text][data-p]').forEach(inp => {{
    const p = parseInt(inp.dataset.p, 10);
    inp.value.split(/[；;]/).filter(s => s.trim()).forEach(part => {{
      const m = part.match(/^\\s*([a-zA-Z]+)\\s*[：:]\\s*(.+)$/);
      if (m) (evMap[p] = evMap[p] || {{}})[m[1]] = m[2].trim();
    }});
  }});
  for (let i = 0; i < n; i++) {{
    const row = {{}};
    col.querySelectorAll(`input[type=checkbox][data-p="${{i}}"]`).forEach(cb => row[cb.dataset.k] = cb.checked ? 1 : 0);
    const radio = col.querySelector(`input[type=radio][data-p="${{i}}"]:checked`);
    labels.push(row); emotion.push(radio ? parseInt(radio.value, 10) : 0); evidence.push(evMap[i] || {{}});
  }}
  const otherInp = col.querySelector('input.otherin');
  const other = otherInp ? otherInp.value.split(/[；;]/).map(s => s.trim()).filter(Boolean) : [];
  return {{windowId, bookId, chapterNo, labels, emotion, evidence, other, errors: [],
    meta: {{annotator: "human", labelsVersion: "{labelsVersion}", sheetVersion: "{sheetVersion}",
      annotatedAt: new Date().toISOString()}}}};
}}
function pairRecords(pair) {{
  const col = pair.querySelector('.col');
  return [collect(col, pair.dataset.orig, pair.dataset.origBook, parseInt(pair.dataset.chapter, 10))];
}}

function findMissingEvidence(col) {{
  const missing = [];
  col.querySelectorAll('.pcard').forEach(pc => pc.classList.remove('needev'));
  col.querySelectorAll('.chip input:checked').forEach(cb => {{
    const p = cb.dataset.p, k = cb.dataset.k;
    const inp = col.querySelector(`input[type=text][data-p="${{p}}"]`);
    const hit = inp && inp.value.match(new RegExp(k + '\\\\s*[：:]'));
    inp.classList.toggle('missing', !hit);
    if (!hit) {{
      missing.push({{col, p, key: k}});
      const pc = col.querySelectorAll('.pcard')[parseInt(p, 10)];
      if (pc) pc.classList.add('needev');
    }}
  }});
  return missing;
}}
const SHORT = {{}};
LABELS.forEach(d => SHORT[d.key] = d.short);
function spotsText(missing) {{
  return missing.map(m => '第' + (parseInt(m.p, 10) + 1) + '段·' + (SHORT[m.key] || m.key)).join('、');
}}
function scrollToMissing(missing) {{
  const pc = missing[0].col.querySelectorAll('.pcard')[parseInt(missing[0].p, 10)];
  if (pc) pc.scrollIntoView({{behavior: 'smooth', block: 'center'}});
}}
function findMissingEmotion(col) {{
  const missing = [];
  const n = col.querySelectorAll('.pcard').length;
  for (let i = 0; i < n; i++) {{
    if (!col.querySelector(`input[type=radio][data-p="${{i}}"]:checked`)) missing.push(i);
  }}
  return missing;
}}
function voidMissing(missing) {{
  missing.forEach(m => {{
    const cb = m.col.querySelector(`input[type=checkbox][data-p="${{m.p}}"][data-k="${{m.key}}"]`);
    if (cb) cb.checked = false;
  }});
}}

async function saveCurrent(silent) {{
  const pair = pairs[cur], col = pair.querySelector('.col');
  const missing = findMissingEvidence(col);
  if (missing.length && !silent) {{
    const ok = confirm(spotsText(missing) + ' 判 1 缺证据摘抄。\\n「确定」= 保存并将缺失判分作废（记 0）；「取消」= 留在本窗补证据（已红框标出）。');
    if (!ok) {{ scrollToMissing(missing); return false; }}
  }}
  voidMissing(missing);
  const noEmo = findMissingEmotion(col);
  if (noEmo.length && !silent) {{
    const ok = confirm(noEmo.length + ' 段未选情绪强度。\\n「确定」= 按 0（平静）保存；「取消」= 留在本窗补选。');
    if (!ok) return false;
  }}
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

function fillFromRecord(col, data) {{
  col.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false);
  col.querySelectorAll('input[type=text]').forEach(t => t.value = '');
  col.querySelectorAll('input[type=radio]').forEach(r => r.checked = false);
  (data.labels || []).forEach((row, i) => Object.keys(row).forEach(k => {{
    if (row[k] === 1) {{
      const cb = col.querySelector(`input[type=checkbox][data-p="${{i}}"][data-k="${{k}}"]`);
      if (cb) cb.checked = true;
    }}
  }}));
  (data.evidence || []).forEach((ev, i) => {{
    const text = Object.keys(ev).map(k => k + ':' + ev[k]).join('；');
    if (text) {{ const inp = col.querySelector(`input[type=text][data-p="${{i}}"]`); if (inp) inp.value = text; }}
  }});
  (data.emotion || []).forEach((v, i) => {{
    const r = col.querySelector(`input[type=radio][data-p="${{i}}"][value="${{v}}"]`);
    if (r) r.checked = true;
  }});
  const otherInp = col.querySelector('input.otherin');
  if (otherInp) otherInp.value = (data.other || []).join('；');
}}
async function prefill() {{
  const pair = pairs[cur], btn = document.getElementById('pre');
  btn.disabled = true; btn.textContent = '预标中…';
  try {{
    let data, ok;
    try {{
      const r = await fetch('/api/annotate/' + SCOPE, {{
        method: 'POST', headers: {{'Content-Type': 'application/json'}},
        body: JSON.stringify({{windowId: pair.dataset.orig}})
      }});
      data = await r.json(); ok = r.ok;
    }} catch (e) {{ alert('预标需要工作台服务（server 模式）。'); return; }}
    if (!ok) {{ alert('预标失败：' + (data.error || 'HTTP 错误')); return; }}
    fillFromRecord(pair.querySelector('.col'), data);
    const h3 = pair.querySelector('h3');
    if (!h3.querySelector('.prechip')) h3.insertAdjacentHTML('beforeend', '<span class="prechip">⚡ 已预标，请校正</span>');
  }} finally {{ btn.disabled = false; btn.textContent = '⚡ 预标'; }}
}}
document.getElementById('pre').addEventListener('click', () => prefill());
{prebtn}

function restore(pair) {{
  fillFromRecord(pair.querySelector('.col'), store[pair.dataset.orig] || {{}});
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
  let flat = 0;
  Object.values(store).forEach(rec => {{
    rec.labels.forEach(row => Object.keys(row).forEach(k => {{ if (row[k] === 1) hits[k] = (hits[k] || 0) + 1; }}));
    if (rec.emotion && rec.emotion.length && Math.max(...rec.emotion) - Math.min(...rec.emotion) <= {flatRange}) flat++;
  }});
  document.getElementById('stats').textContent = LABELS.map(d => d.short + ' ' + (hits[d.key] || 0)).join(' · ') + ' · 平直 ' + flat;
  document.getElementById('stats').title = document.getElementById('stats').textContent;
}}
function syncGrid() {{
  const grid = document.getElementById('ggrid');
  grid.innerHTML = '';
  pairs.forEach((p, idx) => {{
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'gbtn' + (isDone(p) ? ' done' : '');
    b.textContent = idx + 1;
    b.dataset.state = isDone(p) ? 'done' : 'todo';
    const rec = store[p.dataset.orig];
    if (rec && rec.flag) b.classList.add('flagged');
    if (idx === cur) b.classList.add('curc');
    b.addEventListener('click', () => {{ closeSheets(); show(idx); }});
    grid.appendChild(b);
  }});
  document.getElementById('cDone').textContent = pairs.filter(isDone).length;
  document.getElementById('cTodo').textContent = pairs.length - pairs.filter(isDone).length;
}}
function filterGrid(mode, el) {{
  document.querySelectorAll('.fchip').forEach(c => c.classList.remove('on'));
  el.classList.add('on');
  document.querySelectorAll('.gbtn').forEach(b => {{
    const flagged = b.classList.contains('flagged');
    const showIt = mode === 'all' || (mode === 'flagged' && flagged) || (mode === 'todo' && b.dataset.state !== 'done');
    b.style.display = showIt ? '' : 'none';
  }});
}}

function closeSheets() {{ document.querySelectorAll('.sheet').forEach(s => s.classList.remove('open')); }}
function openSheet(id) {{ closeSheets(); document.getElementById(id).classList.add('open'); }}
document.getElementById('gridToggle').addEventListener('click', () => openSheet('overviewSheet'));
document.getElementById('export').addEventListener('click', () => {{ renderExport(); openSheet('exportSheet'); }});
function toast(msg) {{
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
}}
function exportLines() {{
  return pairs.flatMap(p => pairRecords(p)).filter(rec => store[rec.windowId])
    .map(rec => JSON.stringify(store[rec.windowId]));
}}
function renderExport() {{
  const lines = exportLines();
  const hits = {{}};
  LABELS.forEach(d => hits[d.key] = 0);
  let flat = 0;
  Object.values(store).forEach(rec => {{
    rec.labels.forEach(row => Object.keys(row).forEach(k => {{ if (row[k] === 1) hits[k] = (hits[k] || 0) + 1; }}));
    if (rec.emotion && rec.emotion.length && Math.max(...rec.emotion) - Math.min(...rec.emotion) <= {flatRange}) flat++;
  }});
  document.getElementById('exstats').innerHTML = '本次导出 <b>' + lines.length + ' 条窗口记录</b> · 命中：'
    + LABELS.map(d => d.short + ' ' + (hits[d.key] || 0)).join(' · ') + ' · <b>派生平直窗 ' + flat + '</b>';
  const sample = lines.length ? JSON.parse(lines[0]) : null;
  document.getElementById('exrec').textContent = sample ? JSON.stringify(sample, null, 1) : '（暂无已保存记录）';
}}
function doDownload() {{
  const lines = exportLines();
  if (!lines.length) {{ toast('还没有已保存的标注'); return; }}
  const blob = new Blob([lines.join('\\n')], {{type: 'application/jsonl'}});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'labels-backup.jsonl'; a.click();
  toast('已下载 ' + lines.length + ' 条记录');
}}
function doCopy() {{
  const lines = exportLines();
  if (!lines.length) {{ toast('还没有已保存的标注'); return; }}
  navigator.clipboard.writeText(lines.join('\\n'))
    .then(() => toast('已复制 ' + lines.length + ' 条记录'))
    .catch(() => toast('复制失败，请用下载'));
}}

document.getElementById('prev').addEventListener('click', () => show(cur - 1));
document.getElementById('skip').addEventListener('click', () => show(cur + 1));
document.getElementById('flag').addEventListener('click', () => setPendingFlag(!pendingFlag));
document.getElementById('next').addEventListener('click', async () => {{
  if (!(await saveCurrent(false))) return;
  show(cur + 1);
}});

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
		emotion=_EMOTION_JSON,
		flatRange=FLAT_RANGE_MAX,
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
