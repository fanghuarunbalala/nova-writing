"""训练数据工作台：导入书 → 生成（仿写/题目注入）→ 标注 的本地 HTTP 服务。

零新依赖（stdlib http.server）。三个约定：
- 数据落盘：夹具/窗口/标注全部在 gitignored 路径（evals/fixtures/books/<alias>/、
  training/artifacts/），标注 jsonl 与训练管线直接对接（无手动导出）；
- LLM 可注入：outline/expand 复用既有模块的 call 参数，测试无网络；
- 单人 last-write-wins；默认 127.0.0.1，--host 0.0.0.0 开放局域网（跨设备共享进度）。
"""

from __future__ import annotations

import argparse
import json
import re
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import expand as expand_mod
from . import outline as outline_mod
from .annotate import STYLE_ANCHOR, call_openai_compat
from .dataset import build_book_windows, read_jsonl, write_jsonl
from .sheet import _SHEET_CSS, generate_sheet_html, load_windows_by_chapter
from .single_sheet import generate_single_html

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_FIXTURES = REPO_ROOT / "evals" / "fixtures" / "books"
DEFAULT_ARTIFACTS = REPO_ROOT / "training" / "artifacts"
NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
DEFAULT_STYLE = "网文叙事：段落形式与节奏贴近原书；对话与叙述交替推进；避免空洞总结与重复。"
MAX_OUTLINE_CHAPTERS = 100


# ---------- 磁盘状态 ----------

class Workbench:
	"""工作台磁盘状态与业务操作（与 HTTP 解耦，便于测试）。"""

	def __init__(
		self,
		artifacts_dir: Path = DEFAULT_ARTIFACTS,
		fixtures_root: Path = DEFAULT_FIXTURES,
		llm_call=call_openai_compat,
	) -> None:
		self.artifacts = Path(artifacts_dir)
		self.fixtures_root = Path(fixtures_root)
		self.llm_call = llm_call
		self.gen_dir = self.artifacts / "gen"
		self.artifacts.mkdir(parents=True, exist_ok=True)

	# --- 路径 ---
	def book_json(self, alias: str) -> Path:
		return self.fixtures_root / alias / "book.json"

	def units_path(self, alias: str, draft: bool = False) -> Path:
		name = f"{alias}-units-draft.json" if draft else f"{alias}-units.json"
		return self.artifacts / name

	def style_path(self, alias: str) -> Path:
		return self.artifacts / f"{alias}-style.md"

	def windows_path(self, alias: str) -> Path:
		return self.artifacts / f"{alias}-windows.jsonl"

	def ai_windows_path(self, alias: str) -> Path:
		return self.artifacts / f"{alias}-ai-windows.jsonl"

	def gen_windows_path(self, gen_id: str) -> Path:
		return self.gen_dir / f"{gen_id}-windows.jsonl"

	def labels_path(self, scope: str) -> Path:
		return self.artifacts / f"labels-{scope}.jsonl"

	# --- 读取 ---
	def book_info(self, alias: str) -> dict:
		book = json.loads(self.book_json(alias).read_text(encoding="utf-8"))
		return {
			"alias": alias,
			"title": book["title"],
			"chapters": book["stats"]["chapters"],
			"paragraphs": book["stats"]["batches"],
			"chars": book["stats"]["chars"],
		}

	def chapters(self, alias: str) -> list[dict]:
		return outline_mod.load_chapters(self.book_json(alias))

	def load_labels(self, scope: str) -> dict:
		path = self.labels_path(scope)
		if not path.exists():
			return {}
		store = {}
		for rec in read_jsonl(path):
			store[rec["windowId"]] = rec
		return store

	def valid_window_ids(self, scope: str) -> set[str]:
		ids: set[str] = set()
		if self.gen_windows_path(scope).exists():
			for rec in read_jsonl(self.gen_windows_path(scope)):
				ids.add(rec["windowId"])
		else:  # 书域：原文窗 + 配对 AI 窗
			for path in (self.windows_path(scope), self.ai_windows_path(scope)):
				if path.exists():
					for rec in read_jsonl(path):
						ids.add(rec["windowId"])
		return ids

	def save_labels(self, scope: str, records: list[dict]) -> int:
		"""合并保存（last-write-wins），临时文件原子写。返回该域记录总数。"""
		valid = self.valid_window_ids(scope)
		store = self.load_labels(scope)
		for rec in records:
			wid = rec.get("windowId")
			if wid not in valid:
				raise ValueError(f"非法 windowId：{wid}")
			store[wid] = rec
		path = self.labels_path(scope)
		path.parent.mkdir(parents=True, exist_ok=True)
		tmp = path.with_suffix(".tmp")
		with open(tmp, "w", encoding="utf-8") as fh:
			for rec in store.values():
				fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
		tmp.replace(path)
		return len(store)

	# --- 书目列表（首页） ---
	def list_books(self) -> list[dict]:
		books = []
		if self.fixtures_root.exists():
			for book_path in sorted(self.fixtures_root.glob("*/book.json")):
				alias = book_path.parent.name
				if not NAME_RE.match(alias):
					continue
				info = self.book_info(alias)
				windows = ai_windows = 0
				pair_total = pair_done = 0
				if self.windows_path(alias).exists():
					windows = len(read_jsonl(self.windows_path(alias)))
					orig_by_ch = load_windows_by_chapter(self.windows_path(alias), source="book")
					if self.ai_windows_path(alias).exists():
						ai_windows = len(read_jsonl(self.ai_windows_path(alias)))
						ai_by_ch = load_windows_by_chapter(
							self.ai_windows_path(alias), source="ai-expanded"
						)
						store = self.load_labels(alias)
						for no, origs in orig_by_ch.items():
							ais = ai_by_ch.get(no)
							if not ais:
								continue  # 无 AI 窗的章不进配对（标注页同样只配交集章）
							for idx, orig in enumerate(origs[: len(ais)]):
								pair_total += 1
								if (
									store.get(orig["windowId"])
									and store.get(ais[idx]["windowId"])
								):
									pair_done += 1
				info.update(
					windows=windows,
					aiWindows=ai_windows,
					hasUnits=self.units_path(alias).exists(),
					hasStyle=self.style_path(alias).exists(),
					pairTotal=pair_total,
					pairDone=pair_done,
				)
				books.append(info)
		return books

	def list_gens(self) -> list[dict]:
		gens = []
		if self.gen_dir.exists():
			for path in sorted(self.gen_dir.glob("*-windows.jsonl")):
				gen_id = path.name[: -len("-windows.jsonl")]
				if not NAME_RE.match(gen_id):
					continue
				records = read_jsonl(path)
				store = self.load_labels(gen_id)
				gens.append(
					{
						"genId": gen_id,
						"windows": len(records),
						"done": sum(1 for r in records if store.get(r["windowId"])),
						"lines": sum(len(r["texts"]) for r in records),
					}
				)
		return gens

	# --- 业务操作 ---
	def import_book_bytes(self, data: bytes, alias: str, title: str) -> dict:
		import sys

		training_root = Path(__file__).resolve().parents[1]
		if str(training_root) not in sys.path:
			sys.path.insert(0, str(training_root))
		from scripts.import_book import build_book_json

		if self.book_json(alias).exists():
			raise FileExistsError(f"书目已存在：{alias}")
		tmp_txt = self.artifacts / f"import-{alias}.txt"
		tmp_txt.write_bytes(data)
		try:
			book = build_book_json(tmp_txt, alias, title or alias)
		finally:
			tmp_txt.unlink(missing_ok=True)
		out_dir = self.fixtures_root / alias
		out_dir.mkdir(parents=True, exist_ok=True)
		(out_dir / "book.json").write_text(json.dumps(book, ensure_ascii=False), encoding="utf-8")
		if not self.style_path(alias).exists():
			self.style_path(alias).write_text(DEFAULT_STYLE, encoding="utf-8")
		return {"alias": alias, "chapters": book["stats"]["chapters"]}

	def extract_outline(self, alias: str, chapters: list[int]) -> list[dict]:
		if len(chapters) > MAX_OUTLINE_CHAPTERS:
			raise ValueError(f"单次提取章数上限 {MAX_OUTLINE_CHAPTERS}")
		all_chapters = {no: (title, text) for no, title, text in self.chapters(alias)}
		units = []
		for no in chapters:
			if no not in all_chapters:
				raise ValueError(f"章号不存在：{no}")
			title, text = all_chapters[no]
			outline, _model = outline_mod.extract_outline(
				title, text, call=self.llm_call
			)
			units.append(
				{
					"id": f"{alias}-su-leaf-{no:02d}",
					"title": outline["title"] or title,
					"chapterNo": no,
					"elements": outline["elements"],
				}
			)
		payload = {"schema": 1, "book": alias, "note": f"draft {time.strftime('%Y-%m-%dT%H:%M:%S%z')}", "units": units}
		self.units_path(alias, draft=True).write_text(
			json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8"
		)
		return units

	def save_units(self, alias: str, units: list[dict]) -> int:
		for unit in units:
			no = int(unit.get("chapterNo", 0))
			if no <= 0:
				raise ValueError("chapterNo 非法")
			elements = unit.get("elements", {})
			unit["elements"] = {
				key: str(elements.get(key, "")).strip()[:100]  # 防泄漏护栏与 outline 一致
				for key in outline_mod.ELEMENT_KEYS
			}
			unit["title"] = str(unit.get("title", "")).strip()[:12]
			unit["id"] = unit.get("id") or f"{alias}-su-leaf-{no:02d}"
		payload = {"schema": 1, "book": alias, "note": f"final {time.strftime('%Y-%m-%dT%H:%M:%S%z')}", "units": units}
		self.units_path(alias).write_text(
			json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8"
		)
		return len(units)

	def build_windows(self, alias: str) -> int:
		records = build_book_windows(self.book_json(alias))
		write_jsonl(records, self.windows_path(alias))
		return len(records)

	def style_anchor(self, alias: str) -> str:
		path = self.style_path(alias)
		if path.exists():
			text = path.read_text(encoding="utf-8").strip()
			if text:
				return text
		return DEFAULT_STYLE

	def generate(
		self,
		alias: str,
		source: str,
		chapter_no: int | None = None,
		topic: dict | None = None,
		form: str | None = None,
		contrast: int | None = None,
		gen_label: str | None = None,
	) -> dict:
		"""仿写（source=outline 取某章定稿大纲）或题目注入（source=topic）。独立为主，
		指定 contrast 章号时生成物并入该书配对 AI 窗。"""
		if source == "outline":
			if not self.units_path(alias).exists():
				raise ValueError("请先在向导里定稿大纲")
			units = json.loads(self.units_path(alias).read_text(encoding="utf-8"))["units"]
			unit = next((u for u in units if int(u["chapterNo"]) == chapter_no), None)
			if unit is None:
				raise ValueError(f"定稿大纲中没有第 {chapter_no} 章")
		elif source == "topic":
			topic = topic or {}
			elements = {
				key: str((topic.get("elements") or {}).get(key, "")).strip()[:100]
				for key in outline_mod.ELEMENT_KEYS
			}
			unit = {
				"id": f"{alias}-topic",
				"title": str(topic.get("title", "自定义题目")).strip()[:12],
				"chapterNo": contrast or 1,
				"elements": elements,
			}
			if not any(elements.values()):
				raise ValueError("自定义题目至少填一个要素")
		else:
			raise ValueError("source 必须是 outline 或 topic")

		style = self.style_anchor(alias)
		resolved_form = form or ("sentence" if alias == "ywjs" else "paragraph")
		if contrast is not None:
			# 对照章行数基准（与既有配对管线一致）
			counts = expand_mod.chapter_line_counts(self.windows_path(alias))
			target = counts.get(contrast, 48)
		else:
			target = 48
		text, model = expand_mod.expand_unit(
			unit, target, call=self.llm_call, style_anchor=style, form=resolved_form
		)
		lines = [l for l in text.splitlines() if l.strip()]
		result: dict = {"lines": len(lines), "model": model, "preview": text}

		if contrast is not None:
			records = expand_mod.ai_windows_from_text(
				text, contrast, book_id=f"{alias}-ai", source="ai-expanded"
			)
			existing = read_jsonl(self.ai_windows_path(alias)) if self.ai_windows_path(alias).exists() else []
			write_jsonl(existing + records, self.ai_windows_path(alias))
			result.update(
				{
					"mode": "paired",
					"annotateUrl": f"/sheet/{alias}",
					"windows": len(records),
				}
			)
		else:
			gen_id = (gen_label and re.sub(r"[^A-Za-z0-9_-]", "-", gen_label)[:32]) or (
				f"{alias}-gen-{time.strftime('%Y%m%d-%H%M%S')}"
			)
			if self.gen_windows_path(gen_id).exists():
				raise FileExistsError(f"生成批次已存在：{gen_id}（换个标注名）")
			records = expand_mod.ai_windows_from_text(
				text, 1, book_id=gen_id, source="ai-generated"
			)
			write_jsonl(records, self.gen_windows_path(gen_id))
			result.update(
				{
					"mode": "independent",
					"genId": gen_id,
					"annotateUrl": f"/label/gen/{gen_id}",
					"windows": len(records),
				}
			)
		return result


# ---------- 页面 ----------

def _esc(value: object) -> str:
	import html as _html

	return _html.escape(str(value), quote=True)


def _page(title: str, body: str, back: str = "/") -> str:
	return f"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{_esc(title)}</title>
<style>{_SHEET_CSS}
 .cards{{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;max-width:1440px;margin:18px auto}}
 .card{{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px}}
 .card h3{{margin:0 0 6px;font-size:16px}}
 .card .meta{{font-size:12.5px;color:var(--muted);margin:2px 0}}
 .card .ops{{margin-top:10px;display:flex;gap:8px;flex-wrap:wrap}}
 .card .ops a{{text-decoration:none;font-size:13px;border:1px solid var(--line);border-radius:9px;padding:5px 12px;color:var(--ink)}}
 .card .ops a.primary{{background:var(--accent);border-color:var(--accent);color:#fff}}
 .panel{{max-width:980px;margin:16px auto;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 22px}}
 .panel h2{{margin:4px 0 12px;font-size:16px;color:var(--ink)}}
 label.f{{display:block;margin:8px 0;font-size:13.5px}}
 label.f input,label.f select,textarea{{width:100%;margin-top:4px;border:1px solid var(--line);border-radius:8px;padding:7px 10px;font:inherit;font-size:14px}}
 textarea{{min-height:90px;resize:vertical}}
 .btn{{border:0;background:var(--accent);color:#fff;font-size:14px;font-weight:600;padding:9px 20px;border-radius:10px;cursor:pointer;margin-top:10px}}
 .btn.ghost{{background:#fff;color:var(--ink);border:1px solid var(--line);font-weight:400}}
 .step{{font-size:12.5px;color:var(--muted);margin:14px 0 4px;letter-spacing:.5px;font-weight:700}}
 .unit{{border:1px dashed var(--line);border-radius:12px;padding:12px 14px;margin:10px 0}}
 .unit .row{{display:grid;grid-template-columns:70px 1fr;gap:8px;margin:6px 0;font-size:13.5px;align-items:center}}
 .chlist label{{display:block;margin:3px 0;font-size:13.5px}}
 #result{{display:none;margin-top:14px;border-top:1px solid var(--line);padding-top:12px;white-space:pre-wrap;font-size:14px}}
 .ok{{color:var(--orig);font-weight:700}} .err{{color:#b91c1c}}
</style></head><body>
<header class="bar"><div><h1>{_esc(title)}</h1><p>prose-gate 训练数据工作台 · <a href="{_esc(back)}">← 返回</a></p></div></header>
{body}
</body></html>"""


def index_html(wb: Workbench) -> str:
	cards = []
	for book in wb.list_books():
		pairs = (
			f"<p class='meta'>配对标注 {book['pairDone']}/{book['pairTotal']}</p>"
			if book["pairTotal"]
			else "<p class='meta'>尚未生成配对 AI 窗</p>"
		)
		units_flag = "✓" if book["hasUnits"] else "未定稿"
		cards.append(
			f"<div class='card'><h3>{_esc(book['title'])} <small style='color:var(--muted)'>{_esc(book['alias'])}</small></h3>"
			f"<p class='meta'>{book['chapters']} 章 · {book['paragraphs']} 段 · {book['windows']} 原文窗 · 大纲{units_flag}</p>"
			f"{pairs}<div class='ops'><a class='primary' href='/book/{_esc(book['alias'])}'>导入向导</a>"
			f"<a href='/gen/{_esc(book['alias'])}'>生成</a>"
			f"<a href='/sheet/{_esc(book['alias'])}'>标注</a></div></div>"
		)
	gen_cards = [
		f"<div class='card'><h3>{_esc(g['genId'])}</h3>"
		f"<p class='meta'>独立生成 {g['windows']} 窗 · 已标 {g['done']} · {g['lines']} 段</p>"
		f"<div class='ops'><a class='primary' href='/label/gen/{_esc(g['genId'])}'>标注</a></div></div>"
		for g in wb.list_gens()
	]
	body = f"""
<div class="cards">{''.join(cards) or '<p style="color:var(--muted)">还没有书目，先导入一本 txt。</p>'}</div>
<div class="panel">
  <h2>导入书</h2>
  <label class="f">别名（字母数字，如 wudao2）<input id="alias" placeholder="alias"></label>
  <label class="f">书名<input id="title" placeholder="书名"></label>
  <label class="f">txt 文件（utf-8 / gbk 自动识别）<input id="file" type="file" accept=".txt"></label>
  <button class="btn" onclick="doImport()">上传并解析</button>
  <p id="msg" class="meta"></p>
</div>
<div class="panel"><h2>独立生成批次（题目注入）</h2><div class="cards" style="margin:0">{''.join(gen_cards) or '<p style="color:var(--muted)">在「生成」页用自定义题目注入后出现在这里。</p>'}</div></div>
<script>
async function doImport() {{
  const alias = document.getElementById('alias').value.trim();
  const title = document.getElementById('title').value.trim();
  const file = document.getElementById('file').files[0];
  const msg = document.getElementById('msg');
  if (!/^[A-Za-z0-9_-]{{1,32}}$/.test(alias) || !file) {{ msg.innerHTML = '<span class="err">需要合法别名和 txt 文件</span>'; return; }}
  msg.textContent = '上传解析中…';
  const buf = await file.arrayBuffer();
  const r = await fetch('/api/books/import?alias=' + alias + '&title=' + encodeURIComponent(title), {{method: 'POST', body: buf}});
  const data = await r.json();
  if (r.ok) {{ msg.innerHTML = '<span class="ok">已导入 ' + data.chapters + ' 章，正在跳转向导…</span>'; setTimeout(() => location.href = '/book/' + alias, 600); }}
  else msg.innerHTML = '<span class="err">' + (data.error || r.status) + '</span>';
}}
</script>"""
	return _page("prose-gate 工作台", body)


def wizard_html(wb: Workbench, alias: str) -> str:
	info = wb.book_info(alias)
	chapters = wb.chapters(alias)
	draft = wb.units_path(alias, draft=True)
	final = wb.units_path(alias)
	units_source = final if final.exists() else (draft if draft.exists() else None)
	units = json.loads(units_source.read_text(encoding="utf-8"))["units"] if units_source else []
	windows_exist = wb.windows_path(alias).exists()
	ai_count = len(read_jsonl(wb.ai_windows_path(alias))) if wb.ai_windows_path(alias).exists() else 0

	ch_rows = "".join(
		f"<label><input type='checkbox' value='{no}' checked> 第{no}章 {_esc(title)}（{len(text.splitlines())} 行）</label>"
		for no, title, text in chapters[:MAX_OUTLINE_CHAPTERS]
	)
	unit_blocks = []
	for u in units:
		rows = "".join(
			f"<div class='row'><span>{k}</span><input data-u='{int(u['chapterNo'])}' data-k='{k}' value=\"{_esc(u['elements'].get(k, ''))}\"></div>"
			for k in outline_mod.ELEMENT_KEYS
		)
		unit_blocks.append(
			f"<div class='unit'><div class='row'><span>标题</span><input data-u='{int(u['chapterNo'])}' data-k='__title' value=\"{_esc(u['title'])}\"></div>{rows}</div>"
		)
	body = f"""
<div class="panel">
  <p class="meta">{_esc(info['title'])} · {info['chapters']} 章 · {info['paragraphs']} 段</p>
  <div class="step">① 提取大纲（LLM，选定章后执行；重复执行覆盖草稿）</div>
  <div class="chlist">{ch_rows}</div>
  <button class="btn" onclick="doOutline()">提取所选章大纲</button>
  <button class="btn ghost" onclick="toggleAll(true)">全选</button>
  <button class="btn ghost" onclick="toggleAll(false)">全不选</button>
  <p id="omsg" class="meta"></p>
</div>
<div class="panel">
  <div class="step">② 编辑大纲并定稿（{'草稿' if units_source == draft else '已定稿，可改后重新保存'}；每要素 ≤100 字防泄漏）</div>
  {''.join(unit_blocks) if unit_blocks else '<p class="meta">先执行 ① 生成草稿。</p>'}
  {'<button class="btn" onclick="saveUnits()">保存定稿</button>' if unit_blocks else ''}
  <p id="umsg" class="meta"></p>
</div>
<div class="panel">
  <div class="step">③ 建原文窗口（自适应窗口大小）</div>
  <p class="meta">{'✓ 已建 ' + str(len(read_jsonl(wb.windows_path(alias)))) + ' 窗' if windows_exist else '未建'}</p>
  <button class="btn" onclick="buildWindows()" {'disabled' if not final.exists() else ''}>{'重建' if windows_exist else '生成'}窗口</button>
  <p id="wmsg" class="meta"></p>
</div>
<div class="panel">
  <div class="step">后续</div>
  <p class="meta">配对 AI 窗 {ai_count} 个 → <a href="/gen/{_esc(alias)}">去生成（仿写/题目注入）</a> · <a href="/sheet/{_esc(alias)}">去配对标注</a></p>
</div>
<script>
async function post(url, body) {{
  const r = await fetch(url, {{method: 'POST', headers: {{'Content-Type': 'application/json'}}, body: JSON.stringify(body || {{}})}});
  const data = await r.json().catch(() => ({{}}));
  return {{ok: r.ok, data}};
}}
function toggleAll(v) {{ document.querySelectorAll('.chlist input').forEach(c => c.checked = v); }}
async function doOutline() {{
  const chapters = Array.from(document.querySelectorAll('.chlist input:checked')).map(c => parseInt(c.value, 10));
  if (!chapters.length) return;
  document.getElementById('omsg').textContent = 'LLM 提取中（每章一次调用）…';
  const {{ok, data}} = await post('/api/books/{_esc(alias)}/outline', {{chapters}});
  if (ok) {{ document.getElementById('omsg').innerHTML = '<span class="ok">已提取 ' + data.units + ' 章草稿，刷新加载编辑…</span>'; setTimeout(() => location.reload(), 600); }}
  else document.getElementById('omsg').innerHTML = '<span class="err">' + (data.error || '失败') + '</span>';
}}
async function saveUnits() {{
  const units = {{}};
  document.querySelectorAll('.unit input').forEach(inp => {{
    const no = inp.dataset.u; units[no] = units[no] || {{}};
    units[no][inp.dataset.k] = inp.value;
  }});
  const payload = Object.keys(units).map(no => ({{
    chapterNo: parseInt(no, 10),
    title: units[no]['__title'] || '',
    elements: {{
      '人物': units[no]['人物'] || '', '地点': units[no]['地点'] || '', '事件': units[no]['事件'] || '',
      '转折': units[no]['转折'] || '', '情绪': units[no]['情绪'] || ''
    }}
  }}));
  const r = await fetch('/api/books/{_esc(alias)}/units', {{method: 'PUT', headers: {{'Content-Type': 'application/json'}}, body: JSON.stringify(payload)}});
  document.getElementById('umsg').innerHTML = r.ok ? '<span class="ok">已定稿 ' + payload.length + ' 章，可建窗/生成</span>' : '<span class="err">保存失败</span>';
  if (r.ok) setTimeout(() => location.reload(), 600);
}}
async function buildWindows() {{
  const {{ok, data}} = await post('/api/books/{_esc(alias)}/windows');
  document.getElementById('wmsg').innerHTML = ok ? '<span class="ok">已建 ' + data.windows + ' 窗</span>' : '<span class="err">' + (data.error || '失败') + '</span>';
}}
</script>"""
	return _page(f"导入向导 · {info['title']}", body)


def gen_html(wb: Workbench, alias: str) -> str:
	info = wb.book_info(alias)
	units = []
	if wb.units_path(alias).exists():
		units = json.loads(wb.units_path(alias).read_text(encoding="utf-8"))["units"]
	chapters = wb.chapters(alias)
	unit_opts = "".join(
		f"<option value='{int(u['chapterNo'])}'>第{int(u['chapterNo'])}章 {_esc(u['title'])}</option>"
		for u in units
	)
	ch_opts = "<option value=''>不对照（独立标注）</option>" + "".join(
		f"<option value='{no}'>第{no}章 {_esc(title)}</option>" for no, title, _ in chapters
	)
	topic_rows = "".join(
		f"<label class='f'>{k}<input id='t-{k}' placeholder='一句话'></label>"
		for k in outline_mod.ELEMENT_KEYS
	)
	body = f"""
<div class="panel">
  <p class="meta">{_esc(info['title'])} · 生成来源二选一 · 扩写只见大纲不见原文</p>
  <label class="f">来源
    <select id="source" onchange="toggleSource()">
      <option value="outline">某章定稿大纲（仿写）</option>
      <option value="topic">自定义题目（注入）</option>
    </select></label>
  <div id="src-outline"><label class="f">章（需先在向导定稿大纲）<select id="unit-ch">{unit_opts or '<option value="">（无定稿大纲）</option>'}</select></label></div>
  <div id="src-topic" style="display:none"><label class='f'>标题<input id="t-title" placeholder="四字内（可选）"></label>{topic_rows}</div>
  <label class="f">对照（配对 = 生成物与该章原文窗配对标；独立 = 单独标注，贴近生产门控）
    <select id="contrast">{ch_opts}</select></label>
  <label class="f">段落形式 <select id="form"><option value="">自动（ywjs=一句一段，其他=长段）</option><option value="sentence">一句一段</option><option value="paragraph">长段</option></select></label>
  <label class="f">批次名（独立模式的标注域，缺省自动时间戳）<input id="genLabel" placeholder="如 wudao-topic-01"></label>
  <label class="f">本书文风基准（扩写 prompt 注入）<textarea id="style">{_esc(wb.style_anchor(alias))}</textarea></label>
  <button class="btn" onclick="doGen()">生成</button>
  <p id="gmsg" class="meta"></p>
  <div id="result"></div>
</div>
<script>
function toggleSource() {{
  const v = document.getElementById('source').value;
  document.getElementById('src-outline').style.display = v === 'outline' ? '' : 'none';
  document.getElementById('src-topic').style.display = v === 'topic' ? '' : 'none';
}}
async function doGen() {{
  const source = document.getElementById('source').value;
  const contrast = document.getElementById('contrast').value;
  const body = {{
    book: '{_esc(alias)}', source,
    form: document.getElementById('form').value || null,
    contrast: contrast ? parseInt(contrast, 10) : null,
    genLabel: document.getElementById('genLabel').value.trim() || null,
    styleAnchor: document.getElementById('style').value.trim() || null,
  }};
  if (source === 'outline') body.chapterNo = parseInt(document.getElementById('unit-ch').value, 10);
  else body.topic = {{
    title: document.getElementById('t-title').value,
    elements: {{
      '人物': document.getElementById('t-人物').value, '地点': document.getElementById('t-地点').value,
      '事件': document.getElementById('t-事件').value, '转折': document.getElementById('t-转折').value,
      '情绪': document.getElementById('t-情绪').value
    }}
  }};
  const msg = document.getElementById('gmsg'); msg.textContent = 'LLM 生成中…';
  const r = await fetch('/api/generate', {{method: 'POST', headers: {{'Content-Type': 'application/json'}}, body: JSON.stringify(body)}});
  const data = await r.json().catch(() => ({{}}));
  if (!r.ok) {{ msg.innerHTML = '<span class="err">' + (data.error || r.status) + '</span>'; return; }}
  msg.innerHTML = '<span class="ok">完成：' + data.mode + ' · ' + data.lines + ' 行 · ' + data.windows + ' 窗 · 模型 ' + data.model + '</span>';
  const box = document.getElementById('result');
  box.style.display = 'block';
  box.innerHTML = '<a href="' + data.annotateUrl + '"><button class="btn">去标注</button></a>\\n\\n' + data.preview;
}}
</script>"""
	return _page(f"生成 · {info['title']}", body)


# ---------- HTTP ----------

def make_handler(wb: Workbench):
	class Handler(BaseHTTPRequestHandler):
		server_version = "prose-gate-workbench/1"

		def log_message(self, fmt, *args):  # 静默常规访问日志
			pass

		def _send(self, code: int, body: bytes, content_type: str) -> None:
			self.send_response(code)
			self.send_header("Content-Type", content_type)
			self.send_header("Content-Length", str(len(body)))
			self.send_header("Cache-Control", "no-store")
			self.end_headers()
			self.wfile.write(body)

		def _json(self, code: int, payload: dict) -> None:
			self._send(code, json.dumps(payload, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

		def _html(self, code: int, text: str) -> None:
			self._send(code, text.encode("utf-8"), "text/html; charset=utf-8")

		def _body(self) -> bytes:
			length = int(self.headers.get("Content-Length") or 0)
			return self.rfile.read(length) if length else b""

		def do_GET(self) -> None:
			parsed = urlparse(self.path)
			path = parsed.path.rstrip("/") or "/"
			try:
				if path == "/":
					self._html(200, index_html(wb))
				elif path.startswith("/book/") and NAME_RE.match(alias := path[6:]):
					self._html(200, wizard_html(wb, alias))
				elif path.startswith("/gen/") and NAME_RE.match(alias := path[5:]):
					self._html(200, gen_html(wb, alias))
				elif path.startswith("/sheet/") and NAME_RE.match(alias := path[7:]):
					if not (wb.windows_path(alias).exists() and wb.ai_windows_path(alias).exists()):
						self._html(400, _page("缺少数据", "<div class='panel'>需要先建原文窗并生成配对 AI 窗。</div>"))
						return
					orig = load_windows_by_chapter(wb.windows_path(alias), source="book")
					ai = load_windows_by_chapter(wb.ai_windows_path(alias), source="ai-expanded")
					page, _ = generate_sheet_html(orig, ai, title=f"配对标注 · {alias}", mode="server", scope=alias)
					self._html(200, page)
				elif path.startswith("/label/gen/") and NAME_RE.match(gen_id := path[11:]):
					path_gen = wb.gen_windows_path(gen_id)
					if not path_gen.exists():
						self._html(404, _page("不存在", "<div class='panel'>生成批次不存在。</div>"))
						return
					page, _ = generate_single_html(
						read_jsonl(path_gen), title=f"独立标注 · {gen_id}", mode="server", scope=gen_id
					)
					self._html(200, page)
				elif path.startswith("/api/labels/") and NAME_RE.match(scope := path[len("/api/labels/"):]):
					self._json(200, wb.load_labels(scope))
				elif path == "/api/books":
					self._json(200, {"books": wb.list_books(), "gens": wb.list_gens()})
				else:
					self._json(404, {"error": "not found"})
			except Exception as exc:  # noqa: BLE001 —— 单人本地工具，错误直接回显
				self._json(500, {"error": str(exc)})

		def do_PUT(self) -> None:
			parsed = urlparse(self.path)
			path = parsed.path.rstrip("/")
			try:
				if path.startswith("/api/books/") and path.endswith("/units"):
					alias = path[len("/api/books/") : -len("/units")]
					if not NAME_RE.match(alias):
						raise ValueError("非法别名")
					units = json.loads(self._body().decode("utf-8"))
					self._json(200, {"units": wb.save_units(alias, units)})
				elif path.startswith("/api/books/") and path.endswith("/style"):
					alias = path[len("/api/books/") : -len("/style")]
					if not NAME_RE.match(alias):
						raise ValueError("非法别名")
					wb.style_path(alias).parent.mkdir(parents=True, exist_ok=True)
					wb.style_path(alias).write_text(self._body().decode("utf-8"), encoding="utf-8")
					self._json(200, {"ok": True})
				else:
					self._json(404, {"error": "not found"})
			except Exception as exc:  # noqa: BLE001
				self._json(400, {"error": str(exc)})

		def do_POST(self) -> None:
			parsed = urlparse(self.path)
			path = parsed.path.rstrip("/")
			query = parse_qs(parsed.query)
			try:
				if path == "/api/books/import":
					alias = (query.get("alias") or [""])[0]
					title = (query.get("title") or [""])[0]
					if not NAME_RE.match(alias):
						raise ValueError("别名仅限字母数字-_，长度 ≤32")
					self._json(200, wb.import_book_bytes(self._body(), alias, title))
				elif path.startswith("/api/books/") and path.endswith("/outline"):
					alias = path[len("/api/books/") : -len("/outline")]
					if not NAME_RE.match(alias):
						raise ValueError("非法别名")
					payload = json.loads(self._body().decode("utf-8"))
					units = wb.extract_outline(alias, [int(c) for c in payload.get("chapters", [])])
					self._json(200, {"units": len(units)})
				elif path.startswith("/api/books/") and path.endswith("/windows"):
					alias = path[len("/api/books/") : -len("/windows")]
					if not NAME_RE.match(alias):
						raise ValueError("非法别名")
					self._json(200, {"windows": wb.build_windows(alias)})
				elif path.startswith("/api/save/") and NAME_RE.match(scope := path[len("/api/save/"):]):
					records = json.loads(self._body().decode("utf-8"))
					if not isinstance(records, list):
						raise ValueError("body 应为记录数组")
					total = wb.save_labels(scope, records)
					self._json(200, {"ok": True, "total": total})
				elif path == "/api/generate":
					payload = json.loads(self._body().decode("utf-8"))
					book = payload.get("book", "")
					if not NAME_RE.match(book):
						raise ValueError("非法书目")
					result = wb.generate(
						book,
						payload.get("source", "topic"),
						chapter_no=payload.get("chapterNo"),
						topic=payload.get("topic"),
						form=payload.get("form"),
						contrast=payload.get("contrast"),
						gen_label=payload.get("genLabel"),
					)
					if payload.get("styleAnchor"):
						wb.style_path(book).parent.mkdir(parents=True, exist_ok=True)
						wb.style_path(book).write_text(payload["styleAnchor"], encoding="utf-8")
					self._json(200, result)
				else:
					self._json(404, {"error": "not found"})
			except Exception as exc:  # noqa: BLE001
				self._json(400, {"error": str(exc)})

	return Handler


def make_server(
	host: str = "127.0.0.1",
	port: int = 8321,
	artifacts_dir: Path = DEFAULT_ARTIFACTS,
	fixtures_root: Path = DEFAULT_FIXTURES,
	llm_call=call_openai_compat,
) -> ThreadingHTTPServer:
	wb = Workbench(artifacts_dir=artifacts_dir, fixtures_root=fixtures_root, llm_call=llm_call)
	return ThreadingHTTPServer((host, port), make_handler(wb))


def main(argv: list[str] | None = None) -> int:
	parser = argparse.ArgumentParser(description="prose-gate 训练数据工作台")
	parser.add_argument("--host", default="127.0.0.1", help="缺省仅本机；0.0.0.0 开放局域网")
	parser.add_argument("--port", type=int, default=8321)
	parser.add_argument("--artifacts", type=Path, default=DEFAULT_ARTIFACTS)
	parser.add_argument("--fixtures-root", type=Path, default=DEFAULT_FIXTURES)
	args = parser.parse_args(argv)

	server = make_server(
		host=args.host, port=args.port, artifacts_dir=args.artifacts, fixtures_root=args.fixtures_root
	)
	print(f"prose-gate 工作台：http://127.0.0.1:{args.port}")
	if args.host == "0.0.0.0":
		import socket

		with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
			s.connect(("8.8.8.8", 80))
			print(f"局域网访问：http://{s.getsockname()[0]}:{args.port}")
	try:
		server.serve_forever()
	except KeyboardInterrupt:
		print("\n已停止")
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
