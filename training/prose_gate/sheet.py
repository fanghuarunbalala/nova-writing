"""两段式配对标注页（PRD 训练数据工作台 v2 F2）。

每个配对窗 = ① 标原文窗 →「下一步」暂存原文侧 → ② 标（窗口概要 + 生成窗）→ 整窗保存。
第②部分默认不显示原文（独立判分，与生成条件同构），折叠「查看原文」可对照。
段落渲染统一卡片化（桌面/移动同构）；底部抽屉：☰ 概览（四态+筛选）、导出 labels。
平直不标注：由情绪线极差派生（labels.FLAT_RANGE_MAX）。双主题（浅色默认，☀️/🌙 切换）。
"""

from __future__ import annotations

import argparse
import html
import json
from pathlib import Path

from .labels import EMOTION_LEVELS, FLAT_RANGE_MAX, LABELS_VERSION, PROSE_GATE_LABELS

SHORT_LABELS = {
	"clicheExpression": "套话",
	"idiomStack": "四字",
	"adjPile": "修饰",
	"uniformSyntax": "同构",
	"explainTelling": "解说",
	"genericMetaphor": "空喻",
	"vagueSpecificity": "空泛",
	"logicJump": "逻辑",
	"awkwardDiction": "用词",
	"voiceFlat": "同腔",
	"surfaceError": "表层",
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
	"logicJump": "#dc2626",
	"awkwardDiction": "#475569",
	"voiceFlat": "#d946ef",
	"surfaceError": "#94a3b8",
}
SHEET_VERSION = "pair-v5"
OUTLINE_KEYS = ("人物", "地点", "事件", "转折", "情绪")

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

_EMOTION_JSON = json.dumps(
	[
		{"value": lv.value, "name": lv.name, "short": lv.short, "anchor": lv.anchor}
		for lv in EMOTION_LEVELS
	],
	ensure_ascii=False,
)

# 标注页共享样式（单花括号纯文本，经 {css} 注入模板——勿用 .format 处理本常量本身）
# 浅色为默认；[data-theme=dark] 暗色套（顶栏 ☀️/🌙 切换，localStorage 记忆）。
_SHEET_CSS = """ :root{--bg:#eef1f6;--card:#fff;--ink:#1c2430;--muted:#69758a;--line:#e3e8f0;
 --orig:#0b7a4b;--ai:#2456c4;--origbg:#f2f9f5;--aibg:#f1f5fd;--accent:#2456c4;--warn:#b45309;
 --shadow:0 1px 3px rgba(28,36,48,.06);--navbg:rgba(255,255,255,.95)}
 [data-theme=dark]{--bg:#12161f;--card:#1b2230;--ink:#e5eaf3;--muted:#8b96ab;--line:#2a3346;
 --orig:#34d399;--ai:#5b8cff;--origbg:#15231d;--aibg:#161d2e;--accent:#5b8cff;--warn:#f59e0b;
 --shadow:0 1px 4px rgba(0,0,0,.45);--navbg:rgba(18,22,31,.95)}
 *{box-sizing:border-box}
 body{margin:0 0 96px;background:var(--bg);color:var(--ink);
  font:15px/1.9 system-ui,"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif}
 .bar{position:sticky;top:0;z-index:20;display:flex;justify-content:space-between;align-items:center;gap:12px;
  padding:12px 20px;background:var(--navbg);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
 .bar h1{font-size:17px;margin:0} .bar p{margin:2px 0 0;font-size:12px;color:var(--muted)}
 .bar-right{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
 .theme{border:1px solid var(--line);background:var(--card);border-radius:10px;padding:8px 12px;font-size:15px;cursor:pointer}
 .prog{font-size:13px;color:var(--muted);background:var(--card);border:1px solid var(--line);border-radius:999px;padding:4px 14px;white-space:nowrap}
 .stats{font-size:12px;color:var(--muted);background:var(--card);border:1px solid var(--line);
  border-radius:999px;padding:4px 12px;max-width:46vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 button.exportbtn{border:0;background:var(--accent);color:#fff;font-size:13px;font-weight:600;
  padding:8px 16px;border-radius:10px;cursor:pointer}
 button.exportbtn:hover{filter:brightness(1.07)}
 .banner{margin:14px auto 0;max-width:980px;background:var(--card);border:1px solid var(--warn);
  border-radius:12px;padding:10px 16px;font-size:13px;color:var(--warn)}
 .legend{margin:14px auto 6px;max-width:980px;background:var(--card);border:1px solid var(--line);border-radius:14px;
  box-shadow:var(--shadow);padding:12px 18px}
 .legend summary{cursor:pointer;font-weight:600;font-size:13.5px}
 .lb{margin:7px 0;font-size:13px;color:var(--muted)} .lb b{color:var(--ink)}
 main{max-width:980px;margin:0 auto;padding:4px 16px 110px}
 h2{font-size:14px;font-weight:700;color:var(--muted);margin:30px 4px 8px;letter-spacing:1px}
 .pair{display:none;background:var(--card);border:1px solid var(--line);border-radius:16px;
  box-shadow:var(--shadow);padding:14px 16px;margin:12px 0}
 .pair.cur{display:block}
 .pair>h3{margin:0 0 10px;font-size:13px;font-weight:700;color:var(--muted);letter-spacing:.5px}
 .doneflag{color:var(--orig);margin-left:10px;font-weight:700}
 .flaggedflag{color:var(--warn);margin-left:6px;font-weight:700}
 .prechip{color:var(--ai);margin-left:8px;font-weight:700}
 .stepper{display:flex;align-items:center;gap:10px;margin:0 0 12px;font-size:13px}
 .step{color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:3px 14px;background:var(--card)}
 .step.cur{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600}
 .stepper .arrow{color:var(--muted)}
 .col{border-radius:12px;padding:10px 12px}
 .col.orig{background:var(--origbg);border:1px solid #d5e9dd}
 .col.ai{background:var(--aibg);border:1px solid #d7e2f8}
 .colhead{display:flex;align-items:center;gap:8px;font-weight:700;font-size:13px;margin:2px 0 8px;flex-wrap:wrap}
 .badge{font-size:11px;font-weight:700;color:#fff;border-radius:999px;padding:2px 11px;letter-spacing:1px}
 .orig .badge{background:var(--orig)} .ai .badge{background:var(--ai)}
 .colhead code{font-size:11px;color:var(--muted);font-weight:400;overflow:hidden;text-overflow:ellipsis}
 .zero,.backorig{border:1px solid var(--line);background:var(--card);color:var(--muted);
  font-size:12px;border-radius:8px;padding:3px 10px;cursor:pointer}
 .zero{margin-left:auto} .zero:hover,.backorig:hover{color:var(--ink);border-color:var(--accent)}
 .outline{margin:2px 0 10px;background:var(--card);border:1px dashed var(--accent);border-radius:10px;padding:8px 12px}
 .outline summary{cursor:pointer;font-size:12.5px;font-weight:600;color:var(--accent)}
 .outline .olmodel{color:var(--muted);font-weight:400;font-size:11px;margin-left:8px}
 .olrow{display:grid;grid-template-columns:44px 1fr;gap:8px;font-size:13px;margin:4px 0}
 .olrow span{color:var(--muted)} .olrow b{font-weight:600;color:var(--ink)}
 .peek{margin:10px 0 0}
 .peek summary{cursor:pointer;font-size:12.5px;color:var(--muted)}
 .peektext{font-size:13px;color:var(--muted);border-left:2px solid var(--line);padding:2px 0 2px 10px;margin:6px 0}
 .pcard{background:var(--card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);
  padding:10px 12px;margin:8px 0}
 .ptext{font-size:14.5px}
 .chips{margin-top:6px}
 .chip{display:inline-flex;margin:2px 4px 2px 0;cursor:pointer;-webkit-user-select:none;user-select:none}
 .chip input{position:absolute;opacity:0;pointer-events:none}
 .chip span{border:1.5px solid var(--c);color:var(--c);border-radius:999px;padding:1px 10px;
  font-size:12.5px;line-height:1.75;transition:background .12s,color .12s,filter .12s}
 .chip:hover span{filter:brightness(.92)}
 .chip input:checked+span{background:var(--c);color:#fff;font-weight:600}
 .emorow{display:flex;align-items:center;gap:4px;margin-top:6px;font-size:12px;color:var(--muted);flex-wrap:wrap}
 .emolabel{margin-right:2px}
 .emo{display:inline-flex;cursor:pointer;-webkit-user-select:none;user-select:none}
 .emo input{position:absolute;opacity:0;pointer-events:none}
 .emo span{border:1.5px solid var(--muted);color:var(--muted);border-radius:999px;padding:0 9px;
  font-size:12px;line-height:1.8;transition:background .12s,color .12s}
 .emo:hover span{filter:brightness(.92)}
 .emo input:checked+span{background:var(--muted);color:var(--card);font-weight:600}
 .ev{margin-top:6px}
 .ev input{width:100%;border:0;border-bottom:1px dashed var(--muted);background:transparent;color:var(--ink);
  font-size:12.5px;padding:3px 2px;outline:none}
 .ev input:focus{border-bottom:1.5px solid var(--accent)}
 .ev input.missing{border-bottom:2px solid #d64545}
 .pcard.needev{border-color:#d64545;box-shadow:0 0 0 2px rgba(214,69,69,.22)}
 .otherrow{margin-top:10px}
 .otherrow input{width:100%;border:1px dashed var(--muted);background:transparent;color:var(--muted);
  border-radius:8px;font-size:12px;padding:6px 8px;outline:none}
 .otherrow input:focus{color:var(--ink);border-color:var(--accent)}
 .nav{position:fixed;left:0;right:0;bottom:0;z-index:30;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;
  padding:10px 12px calc(10px + env(safe-area-inset-bottom));background:var(--navbg);
  backdrop-filter:blur(8px);border-top:1px solid var(--line)}
 .nav button{min-height:44px;border:1px solid var(--line);background:var(--card);border-radius:12px;
  padding:8px 14px;font-size:13.5px;cursor:pointer;color:var(--ink)}
 .nav button:hover{border-color:var(--accent)}
 .nav .primary{background:var(--accent);color:#fff;border:0;font-weight:600}
 .nav .cnt{font-size:13px;color:var(--muted);min-width:86px;text-align:center;align-self:center}
 .nav .on{border-color:var(--warn);color:var(--warn);font-weight:700}
 .nav button:disabled{opacity:.5;cursor:default}
 /* 底部抽屉：概览 / 导出（移动端单手可达） */
 .sheet{position:fixed;left:0;right:0;bottom:0;z-index:40;background:var(--card);
  border-top:1px solid var(--line);border-radius:18px 18px 0 0;box-shadow:0 -6px 28px rgba(0,0,0,.18);
  padding:14px 16px calc(16px + env(safe-area-inset-bottom));max-height:72vh;overflow:auto;display:none}
 .sheet.open{display:block}
 .sheet h2{margin:0 0 6px;font-size:15px;display:flex;align-items:center;gap:10px;color:var(--ink)}
 .sheet .close{margin-left:auto;border:0;background:none;color:var(--muted);font-size:18px;cursor:pointer;padding:4px 8px}
 .sheet p{font-size:12px;color:var(--muted);margin:10px 0 0}
 .legend2{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin:6px 0 10px}
 .ldot{display:inline-block;width:11px;height:11px;border-radius:4px;margin-right:4px;vertical-align:-1px;background:var(--card)}
 .fchips{display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap}
 .fchip{border:1px solid var(--line);background:var(--card);border-radius:999px;padding:4px 14px;
  font-size:12.5px;cursor:pointer;color:var(--muted)}
 .fchip.on{background:var(--accent);border-color:var(--accent);color:#fff}
 .ggrid{display:flex;flex-wrap:wrap;gap:6px}
 .gbtn{width:40px;height:34px;border:1px solid var(--line);background:var(--card);border-radius:8px;
  font-size:12.5px;cursor:pointer;color:var(--muted)}
 .gbtn.half{border-color:var(--ai);color:var(--ai)}
 .gbtn.done{background:var(--orig);border-color:var(--orig);color:#fff}
 .gbtn.flagged{outline:2px dashed var(--warn);outline-offset:1px}
 .gbtn.curc{outline:2px solid var(--accent);outline-offset:1px}
 .exstats{font-size:13px;color:var(--muted);background:var(--bg);border-radius:10px;padding:10px 12px;margin:8px 0}
 .exstats b{color:var(--ink)}
 pre.rec{background:var(--bg);border-radius:10px;padding:10px 12px;font-size:11.5px;overflow:auto;
  color:var(--ink);white-space:pre-wrap;word-break:break-all;margin:8px 0 10px}
 .btnrow{display:flex;gap:10px;flex-wrap:wrap}
 .btn{border:0;background:var(--accent);color:#fff;font-size:14px;font-weight:600;
  padding:11px 20px;border-radius:11px;cursor:pointer}
 .btn.ghost{background:var(--card);color:var(--ink);border:1px solid var(--line);font-weight:400}
 .toast{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(86px + env(safe-area-inset-bottom));
  background:var(--ink);color:var(--bg);border-radius:10px;padding:10px 18px;font-size:13px;z-index:60;
  opacity:0;transition:opacity .2s;pointer-events:none}
 .toast.show{opacity:1}
 @media (max-width:720px){
  main{padding:4px 10px 110px}
  .bar{padding:10px 12px} .bar h1{font-size:15px}
  .stats{max-width:40vw}
  .nav button{padding:8px 11px;font-size:13px}
  .gbtn{width:11.5%;min-width:38px}
 }
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
		"prebtn": "document.getElementById('pre').style.display = 'none';  // 离线单文件无预标服务",
	},
	"server": {
		"loadStore": "store = await (await fetch('/api/labels/' + SCOPE)).json();",
		"persist": (
			"try { const r = await fetch('/api/save/' + SCOPE, {method: 'POST', "
			"headers: {'Content-Type': 'application/json'}, body: JSON.stringify(recs)}); "
			"if (!r.ok) alert('保存失败 HTTP ' + r.status); } "
			"catch (e) { alert('保存到服务器失败：' + e); }"
		),
		"prebtn": "",
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


def build_pairs(
	original_records: list[dict], ai_records: list[dict]
) -> tuple[list[tuple[dict, dict]], int]:
	"""按 pairWindowId 显式配对（F1）；返回 (配对列表, 无映射的旧章级 AI 窗数)。"""
	paired = {r["pairWindowId"]: r for r in ai_records if r.get("pairWindowId")}
	pairs = [(o, paired[o["windowId"]]) for o in original_records if o["windowId"] in paired]
	pairs.sort(key=lambda p: (int(p[0]["chapterNo"]), p[0]["windowId"]))
	return pairs, len(ai_records) - len(paired)


def _render_paras(texts: list[str], prefix: str) -> str:
	"""段落卡片（两栏通用）：文字 → 7 缺陷胶囊 → 情绪 0-3 单选 → 证据输入。"""
	rows = []
	for i, text in enumerate(texts, start=1):
		chips = "".join(
			f'<label class="chip" style="--c:{LABEL_COLORS[d.key]}" title="{html.escape(d.rubric)}">'
			f'<input type="checkbox" data-w="{prefix}W" data-p="{i - 1}" data-k="{d.key}">'
			f"<span>{html.escape(SHORT_LABELS[d.key])}</span></label>"
			for d in PROSE_GATE_LABELS
		)
		radios = "".join(
			f'<label class="emo" title="{html.escape(lv.anchor)}">'
			f'<input type="radio" name="{prefix}-emo-{i}" data-p="{i - 1}" value="{lv.value}">'
			f"<span>{lv.short}</span></label>"
			for lv in EMOTION_LEVELS
		)
		rows.append(
			f'<div class="pcard"><div class="ptext">{i}. {html.escape(text)}</div>'
			f'<div class="chips">{chips}</div>'
			f'<div class="emorow"><span class="emolabel">情绪</span>{radios}</div>'
			f'<div class="ev"><input type="text" data-w="{prefix}W" data-p="{i - 1}" '
			f'placeholder="证据（判 1 必填；勾选自动填整段，删减即可）格式 key:摘抄；key:摘抄"></div></div>'
		)
	return "\n".join(rows)


def _render_outline(outline: dict | None) -> str:
	"""第②部分的窗口概要只读卡（提炼自原文窗，只读、默认展开可折叠）。"""
	if not outline:
		return ""
	elements = outline.get("elements", {}) or {}
	rows = "".join(
		f'<div class="olrow"><span>{key}</span><b>{html.escape(str(elements.get(key, "—")))}</b></div>'
		for key in OUTLINE_KEYS
	)
	model = html.escape(str(outline.get("model", "")))
	return (
		f'<details open class="outline"><summary>窗口概要（提炼自原文窗，只读）'
		f'<span class="olmodel">{model}</span></summary>{rows}</details>'
	)


_PAIR_BLOCK = """<section class="pair" data-orig="{orig_id}" data-ai="{ai_id}" data-orig-book="{orig_book}" data-ai-book="{ai_book}" data-chapter="{chapter}" data-step="1">
  <h3>配对窗 {seq} · 第 {chapter} 章</h3>
  <div class="stepper"><span class="step cur" data-step="1">① 标原文窗</span><span class="arrow">→</span><span class="step" data-step="2">② 标生成内容</span></div>
  <div class="part part1">
    <div class="col orig"><div class="colhead"><span class="badge">原文窗</span><code>{orig_id}</code><button type="button" class="zero">全零</button></div>
{orig_paras}
      <div class="otherrow"><input type="text" class="otherin" placeholder="其他（缺陷之外的问题，不判分，；分隔）——表层标点/逻辑跳跃/用词/角色腔随手记"></div>
    </div>
  </div>
  <div class="part part2" hidden>
    <div class="col ai"><div class="colhead"><span class="badge">概要 + 生成窗</span><code>{ai_id}</code><button type="button" class="backorig">‹ 回原文部分</button><button type="button" class="zero">全零</button></div>
{outline_card}
{ai_paras}
      <div class="otherrow"><input type="text" class="otherin" placeholder="其他（缺陷之外的问题，不判分，；分隔）——表层标点/逻辑跳跃/用词/角色腔随手记"></div>
      <details class="peek"><summary>查看原文（对照用，判分请独立）</summary><div class="peektext">{peek}</div></details>
    </div>
  </div>
</section>"""


def _render_pair(seq: int, orig: dict, ai: dict, outline: dict | None) -> str:
	peek = html.escape("／".join(orig["texts"]))
	return _PAIR_BLOCK.format(
		seq=seq,
		orig_id=html.escape(orig["windowId"]),
		ai_id=html.escape(ai["windowId"]),
		orig_book=html.escape(orig["bookId"]),
		ai_book=html.escape(ai["bookId"]),
		chapter=int(orig.get("chapterNo", 1)),
		orig_paras=_render_paras(orig["texts"], "o"),
		ai_paras=_render_paras(ai["texts"], "a"),
		outline_card=_render_outline(outline),
		peek=peek,
	)


def generate_sheet_html(
	pairs: list[tuple[dict, dict]],
	outlines: dict[str, dict] | None = None,
	title: str = "prose-gate 配对标注表",
	mode: str = "local",
	scope: str = "sheet",
	legacy_count: int = 0,
) -> tuple[str, int]:
	"""两段式配对标注页 HTML；返回 (html, 配对窗总数)。

	pairs：[(原文窗记录, 生成窗记录)]（build_pairs 按 pairWindowId 配好）；
	outlines：原文窗Id → 窗口概要；legacy_count：无映射的旧章级 AI 窗数（页头横幅提示重跑）。
	"""
	outlines = outlines or {}
	sections: list[str] = []
	chapter_now = None
	seq = 0
	for orig, ai in pairs:
		no = int(orig.get("chapterNo", 1))
		if no != chapter_now:
			chapter_now = no
			sections.append(f'<h2>第 {no} 章</h2>')
		seq += 1
		sections.append(_render_pair(seq, orig, ai, outlines.get(orig["windowId"])))

	banner = (
		f'<div class="banner">检测到 {legacy_count} 个旧「整章仿写」AI 窗（无窗口映射，不计入进度）——'
		f"请在生成页对相应章重跑「窗口级配对生成」。</div>"
		if legacy_count and pairs
		else (
			'<div class="banner">本书还没有窗口级配对数据（现有 AI 窗均为旧章级数据）——'
			"请到「生成」页选择章节执行「窗口级配对生成」后再来标注。</div>"
			if legacy_count
			else '<div class="banner">还没有配对数据——请先到「生成」页执行「窗口级配对生成」。</div>'
			if not pairs
			else ""
		)
	)

	if mode not in _STORAGE_SNIPPETS:
		raise ValueError(f"未知存储模式：{mode}")
	page = _PAGE.format(
		title=html.escape(title),
		pairs=len(pairs),
		banner=banner,
		body="\n".join(sections),
		labels=_LABELS_JSON,
		emotion=_EMOTION_JSON,
		flatRange=FLAT_RANGE_MAX,
		labelsVersion=LABELS_VERSION,
		sheetVersion=SHEET_VERSION,
		css=_SHEET_CSS,
		scope=html.escape(scope),
		**_STORAGE_SNIPPETS[mode],
	)
	return page, len(pairs)


def generate_sheet(
	pairs: list[tuple[dict, dict]],
	outlines: dict[str, dict] | None,
	out_path: Path,
	title: str = "prose-gate 配对标注表",
	mode: str = "local",
	scope: str = "sheet",
	legacy_count: int = 0,
) -> int:
	"""写出自包含标注表 HTML；返回配对窗总数。"""
	page, pairs_total = generate_sheet_html(
		pairs, outlines, title=title, mode=mode, scope=scope, legacy_count=legacy_count
	)
	out_path.parent.mkdir(parents=True, exist_ok=True)
	out_path.write_text(page, encoding="utf-8")
	return pairs_total


_PAGE = """<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>{css}</style></head><body>
<header class="bar">
  <div><h1>{title}</h1><p>{pairs} 配对窗 · 两段式：① 标原文 → ② 标（概要+生成）→ 保存并下一窗 · 平直不用标（由情绪线派生）</p></div>
  <div class="bar-right"><span id="stats" class="stats">–</span><span id="prog" class="prog">0/{pairs}</span>
    <button id="export" class="exportbtn" type="button">导出 labels</button>
    <button class="theme" id="theme" type="button">🌙</button></div>
</header>
{banner}
<details open class="legend"><summary>缺陷标签 + 情绪线档位（点击折叠 · 建议随手对照）</summary><div id="labels"></div></details>
<main id="pairs">
{body}
</main>
<div class="sheet" id="overviewSheet">
  <h2>概览 · {pairs} 窗<button class="close" type="button" onclick="closeSheets()">✕</button></h2>
  <div class="legend2">
    <span><span class="ldot" style="background:var(--orig)"></span>整窗完成 <i id="cDone"></i></span>
    <span><span class="ldot" style="border-color:var(--ai)"></span>原文已标 <i id="cHalf"></i></span>
    <span><span class="ldot" style="outline:2px dashed var(--warn)"></span>存疑</span>
    <span><span class="ldot" style="border:1px solid var(--line)"></span>未标 <i id="cTodo"></i></span>
  </div>
  <div class="fchips">
    <button class="fchip on" type="button" onclick="filterGrid('all',this)">全部</button>
    <button class="fchip" type="button" onclick="filterGrid('flagged',this)">只看存疑</button>
    <button class="fchip" type="button" onclick="filterGrid('todo',this)">只看未完成</button>
  </div>
  <div class="ggrid" id="ggrid"></div>
  <p>点击格子跳转该窗并关闭抽屉；「原文已标」= 第①部分已暂存，刷新后自动回到第②部分。</p>
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
  <p>server 模式下标注实时落盘服务端（刷新/换设备不丢），导出仅作备份与迁移用。</p>
</div>
<nav class="nav">
  <button id="prev" type="button">‹ 上一窗</button>
  <button id="skip" type="button">跳过</button>
  <button id="gridToggle" type="button">☰ 概览</button>
  <button id="pre" type="button" title="LLM 预填当前部分，人工只做校正">⚡ 预标</button>
  <button id="flag" type="button">⚑ 存疑</button>
  <span class="cnt" id="cnt"></span>
  <button id="next" class="primary" type="button">下一步：标生成 ›</button>
</nav>
<div class="toast" id="toast"></div>
<script>
const LABELS = {labels};
const EMO = {emotion};
const labelsVersion = "{labelsVersion}";
const STORE_KEY = 'prose-gate-sheet:' + document.title;
const SCOPE = "{scope}";

// 主题（浅色默认，localStorage 记忆）
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
  + `<div class="lb"><b>情绪线（每段必选，免证据）</b> ${{EMO.map(e => e.value + ' ' + e.name + '：' + e.anchor).join('；')}}<br><i>只描述纸上实际多强，不评价应该多强。窗口平直（派生，不用标）= 全窗 max−min ≤ {flatRange}——全程死水与全程爆发都算平直。</i></div>`;

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

// ---- 两段式 ----
function part1col(pair) {{ return pair.querySelector('.part1 .col'); }}
function part2col(pair) {{ return pair.querySelector('.part2 .col'); }}
function setStep(pair, step) {{
  pair.dataset.step = step;
  pair.querySelector('.part1').hidden = step != 1;
  pair.querySelector('.part2').hidden = step != 2;
  pair.querySelectorAll('.step').forEach(s => s.classList.toggle('cur', s.dataset.step == step));
  const next = document.getElementById('next');
  if (step == 1) {{ next.textContent = '下一步：标生成 ›'; document.getElementById('pre').title = 'LLM 预填原文窗（第①部分）'; }}
  else {{ next.textContent = '保存并下一窗 ›'; document.getElementById('pre').title = 'LLM 预填生成窗（第②部分）'; }}
}}
document.querySelectorAll('.pair .backorig').forEach(btn => btn.addEventListener('click', () =>
  setStep(pairs[cur], 1)));

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
  const no = parseInt(pair.dataset.chapter, 10);
  return [
    collect(part1col(pair), pair.dataset.orig, pair.dataset.origBook, no),
    collect(part2col(pair), pair.dataset.ai, pair.dataset.aiBook, no)
  ];
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

async function nextStep(silent) {{
  const pair = pairs[cur], col = part1col(pair);
  const missing = findMissingEvidence(col);
  if (missing.length && !silent) {{
    const ok = confirm(spotsText(missing) + ' 判 1 缺证据摘抄。\\n「确定」= 暂存并将缺失判分作废（记 0）；「取消」= 留在本部分补证据（已红框标出）。');
    if (!ok) {{ scrollToMissing(missing); return false; }}
  }}
  voidMissing(missing);
  const noEmo = findMissingEmotion(col);
  if (noEmo.length && !silent) {{
    const ok = confirm(noEmo.length + ' 段未选情绪强度。\\n「确定」= 按 0（平静）暂存；「取消」= 留在本部分补选。');
    if (!ok) return false;
  }}
  const rec = collect(col, pair.dataset.orig, pair.dataset.origBook, parseInt(pair.dataset.chapter, 10));
  if (pendingFlag) rec.flag = true;
  store[rec.windowId] = rec;
  await persistStore([rec]);  // 暂存原文侧：刷新后回到第②部分（中间态可恢复）
  setPendingFlag(false);
  setStep(pair, 2);
  syncGrid(); upd();
  return true;
}}

async function saveCurrent(silent) {{
  const pair = pairs[cur];
  if (pair.dataset.step == '1') {{
    if (!silent) return await nextStep(false);  // 第①部分的主按钮即「下一步」
    return false;
  }}
  const col = part2col(pair);
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
  const recs = pairRecords(pair);  // 整窗两条记录最终一致（原文侧复写）
  recs.forEach(rec => {{ if (pendingFlag) rec.flag = true; store[rec.windowId] = rec; }});
  await persistStore(recs);
  setPendingFlag(false);
  pair.classList.add('done');
  const h3 = pair.querySelector('h3');
  if (!h3.querySelector('.doneflag')) h3.insertAdjacentHTML('beforeend', '<span class="doneflag">✓ 已保存</span>');
  syncGrid(); upd();
  return true;
}}

// ---- LLM 预标（按当前部分） ----
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
  const step = pair.dataset.step;
  const wid = step == '1' ? pair.dataset.orig : pair.dataset.ai;
  btn.disabled = true; btn.textContent = '预标中…';
  try {{
    let data, ok;
    try {{
      const r = await fetch('/api/annotate/' + SCOPE, {{
        method: 'POST', headers: {{'Content-Type': 'application/json'}},
        body: JSON.stringify({{windowId: wid}})
      }});
      data = await r.json(); ok = r.ok;
    }} catch (e) {{ alert('预标需要工作台服务（server 模式）。'); return; }}
    if (!ok) {{ alert('预标失败：' + (data.error || 'HTTP 错误')); return; }}
    fillFromRecord(step == '1' ? part1col(pair) : part2col(pair), data);
    const h3 = pair.querySelector('h3');
    if (!h3.querySelector('.prechip')) h3.insertAdjacentHTML('beforeend', '<span class="prechip">⚡ 已预标，请校正</span>');
  }} finally {{ btn.disabled = false; btn.textContent = '⚡ 预标'; }}
}}
document.getElementById('pre').addEventListener('click', () => prefill());
{prebtn}

function restore(pair) {{
  [pair.dataset.orig, pair.dataset.ai].forEach((wid, ci) => {{
    const rec = store[wid], col = ci === 0 ? part1col(pair) : part2col(pair);
    fillFromRecord(col, rec || {{}});
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
  if (!pairs.length) return;  // 全旧数据/无配对：停在横幅提示，不进交互
  cur = Math.max(0, Math.min(pairs.length - 1, i));
  const pair = pairs[cur];
  pairs.forEach((p, idx) => p.classList.toggle('cur', idx === cur));
  restore(pair);
  setPendingFlag(currentFlagged());
  // 中间态恢复：原文已暂存而生成未标 → 直接回第②部分
  setStep(pair, (store[pair.dataset.orig] && !store[pair.dataset.ai]) ? '2' : '1');
  document.getElementById('cnt').textContent = (cur + 1) + '/' + pairs.length + (isDone(pair) ? ' ✓' : '');
  document.querySelector('main').scrollIntoView({{behavior: 'instant', block: 'start'}});
  syncGrid();
}}
function isDone(pair) {{
  return !!store[pair.dataset.orig] && !!store[pair.dataset.ai];
}}
function isHalf(pair) {{
  return !!store[pair.dataset.orig] && !store[pair.dataset.ai];
}}
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
function gridState(pair) {{
  if (isDone(pair)) return 'done';
  if (isHalf(pair)) return 'half';
  return 'todo';
}}
function syncGrid() {{
  const grid = document.getElementById('ggrid');
  grid.innerHTML = '';
  pairs.forEach((p, idx) => {{
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'gbtn ' + gridState(p);
    b.textContent = idx + 1;
    b.dataset.state = gridState(p);
    const rec = store[p.dataset.orig];
    if (rec && rec.flag) b.classList.add('flagged');
    if (idx === cur) b.classList.add('curc');
    b.addEventListener('click', () => {{ closeSheets(); show(idx); }});
    grid.appendChild(b);
  }});
  document.getElementById('cDone').textContent = pairs.filter(isDone).length;
  document.getElementById('cHalf').textContent = pairs.filter(isHalf).length;
  document.getElementById('cTodo').textContent = pairs.length - pairs.filter(isDone).length;
}}
function filterGrid(mode, el) {{
  document.querySelectorAll('.fchip').forEach(c => c.classList.remove('on'));
  el.classList.add('on');
  document.querySelectorAll('.gbtn').forEach(b => {{
    const s = b.dataset.state;
    const flagged = b.classList.contains('flagged');
    const showIt = mode === 'all' || (mode === 'flagged' && flagged) || (mode === 'todo' && s !== 'done');
    b.style.display = showIt ? '' : 'none';
  }});
}}

// ---- 底部抽屉 / 导出 ----
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
  a.href = URL.createObjectURL(blob); a.download = 'labels-human.jsonl'; a.click();
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
	parser = argparse.ArgumentParser(description="生成两段式配对标注表 HTML（窗口级配对）")
	parser.add_argument("--original", type=Path, default=Path("artifacts/windows.jsonl"))
	parser.add_argument("--ai", type=Path, default=Path("artifacts/ai-windows.jsonl"))
	parser.add_argument("--outlines", type=Path, default=None, help="窗口概要 json（缺省 artifacts/<book>-window-outlines.json）")
	parser.add_argument("--out", type=Path, default=Path("artifacts/annotation-sheet.html"))
	parser.add_argument("--title", default="prose-gate 配对标注表")
	args = parser.parse_args(argv)

	with open(args.original, encoding="utf-8") as fh:
		original = [json.loads(line) for line in fh if line.strip()]
	outlines: dict[str, dict] = {}
	outlines_path = args.outlines or args.original.parent / "window-outlines.json"
	if outlines_path.exists():
		payload = json.loads(outlines_path.read_text(encoding="utf-8"))
		outlines = payload.get("windows") or {}
	with open(args.ai, encoding="utf-8") as fh:
		ai_records = [json.loads(line) for line in fh if line.strip()]
	pairs, legacy = build_pairs(
		[r for r in original if r.get("source") == "book"], ai_records
	)
	count = generate_sheet(pairs, outlines, args.out, title=args.title, legacy_count=legacy)
	print(f"两段式标注表 → {args.out}（{count} 配对窗，旧章级 {legacy} 窗不计入）")
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
