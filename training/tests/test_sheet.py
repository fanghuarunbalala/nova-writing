"""两段式配对标注页测试（PRD 工作台 v2 F2）：结构、pairWindowId 映射、导出抽屉、JS 配平。"""

from __future__ import annotations

import re
from pathlib import Path

from prose_gate.sheet import SHEET_VERSION, build_pairs, generate_sheet
from prose_gate.single_sheet import generate_single_html


def make_orig(chapter: int, book: str, n_windows: int = 2, n_paras: int = 8) -> list[dict]:
	return [
		{
			"windowId": f"{book}-c{chapter:03d}-w{i:03d}",
			"bookId": book,
			"chapterNo": chapter,
			"source": "book",
			"lineIndexes": list(range(n_paras)),
			"texts": [f"{book} 第{i}段{j}句。" for j in range(n_paras)],
			"features": [[0.0] * 8 for _ in range(n_paras)],
		}
		for i in range(n_windows)
	]


def make_ai(orig: list[dict], n_paras: int = 8) -> list[dict]:
	return [
		{
			"windowId": r["windowId"].replace(f"-c", "-ai-c", 1),
			"bookId": r["bookId"] + "-ai",
			"chapterNo": r["chapterNo"],
			"source": "ai-expanded",
			"pairWindowId": r["windowId"],
			"lineIndexes": list(range(n_paras)),
			"texts": [f"AI 第{j}句扩写。" for j in range(n_paras)],
			"features": [[0.0] * 8 for _ in range(n_paras)],
		}
		for r in orig
	]


def test_build_pairs_maps_by_pair_window_id():
	orig = make_orig(1, "ywjs")
	ai = make_ai(orig)
	legacy = dict(ai[0], windowId="ywjs-ai-legacy", pairWindowId=None)
	pairs, legacy_count = build_pairs(orig, ai + [legacy])
	assert len(pairs) == 2
	assert legacy_count == 1
	assert pairs[0][0]["windowId"] == "ywjs-c001-w000"
	assert pairs[0][1]["pairWindowId"] == "ywjs-c001-w000"
	# 无映射的原文窗不进配对
	solo, _ = build_pairs(orig + make_orig(2, "ywjs"), ai)
	assert len(solo) == 2


def test_generate_sheet_two_part_structure(tmp_path: Path):
	orig = make_orig(1, "ywjs") + make_orig(2, "ywjs", n_windows=1)
	ai = make_ai(orig)
	pairs, legacy = build_pairs(orig, ai + [dict(ai[0], windowId="ywjs-ai-legacy", pairWindowId=None)])
	outlines = {
		"ywjs-c001-w000": {
			"title": "入镇",
			"elements": {"人物": "沈砚", "地点": "小镇", "事件": "避雨", "转折": "改口", "情绪": "戒备"},
			"model": "test-llm",
			"chapterNo": 1,
		}
	}
	out = tmp_path / "sheet.html"
	count = generate_sheet(pairs, outlines, out, legacy_count=legacy)
	html = out.read_text(encoding="utf-8")
	assert count == 3
	# 两段式结构：第①部分原文 / 第②部分概要+生成 / 查看原文折叠 / 步骤条
	assert 'class="part part1"' in html and 'class="part part2"' in html
	assert "① 标原文窗" in html and "② 标生成内容" in html
	assert "窗口概要（提炼自原文窗，只读）" in html and "test-llm" in html
	assert "查看原文（对照用，判分请独立）" in html
	# 概览/导出抽屉与旧数据横幅
	assert 'id="overviewSheet"' in html and 'id="exportSheet"' in html and "旧「整章仿写」" in html
	assert SHEET_VERSION in html
	# 控件数：每窗 (原文 8 段 + AI 8 段) × 11 胶囊；情绪单选 ×4 —— 共 3 窗；其他备注框 2/窗
	assert html.count('type="checkbox"') == 3 * 16 * 11
	assert html.count('type="radio"') == 3 * 16 * 4
	assert html.count('class="otherin"') == 3 * 2
	# 标签定义 + 情绪线注入；flatAffect 已移除；v3 新标签就位
	assert "clicheExpression" in html and "flatAffect" not in html
	for short in ("逻辑", "用词", "同腔", "表层"):
		assert short in html
	assert "情绪线" in html


def test_generate_sheet_only_mapped_pairs_annotate(tmp_path: Path):
	orig = make_orig(1, "ywjs") + make_orig(9, "ywjs")
	ai = make_ai(orig[:2])  # 第 9 章无配对生成窗
	pairs, _ = build_pairs(orig, ai)
	assert len(pairs) == 2  # 第 9 章原文窗无映射，不进标注页


def test_generated_pages_js_brackets_balance(tmp_path: Path):
	"""页面脚本是 format 模板拼接的高危区：括号不配平 = 整页 JS 不执行（曾真实发生：
	upd() 统计行多继承一个 ')'）。粗粒度配平检查兜底。"""
	orig = make_orig(1, "ywjs")
	pairs, _ = build_pairs(orig, make_ai(orig))
	pages = [
		(
			generate_sheet(pairs, None, tmp_path / "a.html")
			and (tmp_path / "a.html").read_text(encoding="utf-8")
		),
		generate_single_html(make_ai(orig), mode="local", scope="g")[0],
	]
	for page in pages:
		script = re.search(r"<script>([\s\S]*?)</script>", page)
		assert script, "页面缺 <script>"
		js = script.group(1)
		assert js.count("(") == js.count(")"), f"圆括号不配平：{js.count('(')} vs {js.count(')')}"
		assert js.count("{") == js.count("}"), f"花括号不配平：{js.count('{')} vs {js.count('}')}"
