"""组窗器测试：重切 / 边界 / 步长 / 尾窗回退。"""

from __future__ import annotations

from prose_gate.windowing import build_windows, re_split_paragraphs


def make_units(n: int) -> list:
	from prose_gate.windowing import SentenceUnit

	return [SentenceUnit(line_index=i, text=f"第{i}句。") for i in range(n)]


def test_re_split_compatible_with_crlf_and_blank_lines():
	units = re_split_paragraphs("第一句。\r\n\r\n第二句。\r第三句。\n")
	assert [u.text for u in units] == ["第一句。", "第二句。", "第三句。"]
	assert [u.line_index for u in units] == [0, 2, 3]


def test_short_chapter_single_window():
	windows = build_windows("bk", 1, make_units(7))
	assert len(windows) == 1
	assert len(windows[0].units) == 7
	assert windows[0].window_id == "bk-c001-w000"


def test_exact_size_single_window():
	windows = build_windows("bk", 2, make_units(8))
	assert len(windows) == 1 and len(windows[0].units) == 8


def test_sliding_and_tail_backoff():
	# 20 段：滑窗起点 0,4,8,12（12 == len-8 已覆盖尾）→ 4 窗
	windows = build_windows("bk", 3, make_units(20))
	assert [len(w.units) for w in windows] == [8, 8, 8, 8]
	# 首窗从第 0 段起，末窗覆盖到第 19 段
	assert windows[0].units[0].line_index == 0
	assert windows[-1].units[-1].line_index == 19

	# 10 段：起点 0，尾窗回退到 2 → 两窗且都满 8 段
	windows = build_windows("bk", 4, make_units(10))
	assert [len(w.units) for w in windows] == [8, 8]
	assert windows[-1].units[-1].line_index == 9


def test_empty_chapter():
	assert build_windows("bk", 5, []) == []


def test_window_ids_unique_and_ordered():
	windows = build_windows("bk", 6, make_units(30))
	ids = [w.window_id for w in windows]
	assert len(ids) == len(set(ids))
	assert ids == sorted(ids)
