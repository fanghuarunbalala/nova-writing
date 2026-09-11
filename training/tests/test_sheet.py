"""配对标注表测试：HTML 内容、配对数、导出 JS 元素（无网络）。"""

from __future__ import annotations

from pathlib import Path

from prose_gate.sheet import SHEET_VERSION, generate_sheet


def make_records(chapter: int, book: str, source: str, n_windows: int = 2) -> list[dict]:
	return [
		{
			"windowId": f"{book}-c{chapter:03d}-w{i:03d}",
			"bookId": book,
			"chapterNo": chapter,
			"source": source,
			"lineIndexes": list(range(8)),
			"texts": [f"{book} 第{i}段{j}句。" for j in range(8)],
			"features": [[0.0] * 8 for _ in range(8)],
		}
		for i in range(n_windows)
	]


def test_generate_sheet_contains_pairs_and_export(tmp_path: Path):
	original = {1: make_records(1, "ywjs", "book"), 2: make_records(2, "ywjs", "book")}
	ai = {1: make_records(1, "ywjs-ai", "ai-expanded"), 2: make_records(2, "ywjs-ai", "ai-expanded", n_windows=3)}
	out = tmp_path / "sheet.html"
	pairs = generate_sheet(original, ai, out)
	html = out.read_text(encoding="utf-8")
	assert pairs == 4  # 每章 zip 到较短侧：2 + 2
	assert "ywjs-c001-w000" in html and "ywjs-ai-c001-w000" in html
	assert 'id="export"' in html and "labels-human.jsonl" in html
	assert SHEET_VERSION in html
	# 复选框数 = 配对 × 双栏（原文+AI 两侧都标）× 8 段 × 8 标签
	assert html.count('type="checkbox"') == 4 * 2 * 8 * 8
	# 标签定义注入
	assert "clicheExpression" in html and "flatAffect" in html


def test_generate_sheet_only_intersects_chapters(tmp_path: Path):
	original = {1: make_records(1, "ywjs", "book"), 9: make_records(9, "ywjs", "book")}
	ai = {1: make_records(1, "ywjs-ai", "ai-expanded")}
	pairs = generate_sheet(original, ai, tmp_path / "s.html")
	assert pairs == 2  # 第 9 章无 AI 侧，不计
