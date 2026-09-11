"""组窗器：章级整块文本 → 一句一段单元 → 同章滑窗（PRD F1）。

数据口径：evals 书库夹具的 FixtureParagraph.text 是章级整块（正文按行分隔），
组窗前先 re_split_paragraphs 切回"一句一段"单元；窗口 = 同章连续 ≤8 段，
步长 4，不跨章（章由调用方传入）。
"""

from __future__ import annotations

import re
from dataclasses import dataclass

WINDOW_SIZE = 8
WINDOW_STEP = 4


@dataclass(frozen=True)
class SentenceUnit:
	"""重切后的句段单元。line_index 为章内行号（重切后序），用于溯源。"""

	line_index: int
	text: str


@dataclass(frozen=True)
class Window:
	"""同章连续句段窗口（n ≤ size）。"""

	window_id: str
	book_id: str
	chapter_no: int
	units: tuple[SentenceUnit, ...]

	@property
	def texts(self) -> tuple[str, ...]:
		return tuple(u.text for u in self.units)


def re_split_paragraphs(chapter_text: str) -> list[SentenceUnit]:
	"""章级整块文本按行切回一句一段：兼容 \\r\\n，去每行首尾空白，过滤空行。"""
	units: list[SentenceUnit] = []
	for i, line in enumerate(re.split(r"\r\n|\r|\n", chapter_text)):
		trimmed = line.strip()
		if trimmed == "":
			continue
		units.append(SentenceUnit(line_index=i, text=trimmed))
	return units


def build_windows(
	book_id: str,
	chapter_no: int,
	units: list[SentenceUnit],
	size: int = WINDOW_SIZE,
	step: int = WINDOW_STEP,
) -> list[Window]:
	"""同章滑窗。规则（PRD F1）：
	- 章不足 size 段 → 整章一窗（n < size）；
	- 否则以 step 滑动取满 size 段的窗；若末窗未覆盖到章尾，
	  追加一个起点回退到 len-size 的尾窗（保持满 size、覆盖章尾，优于碎尾窗）。
	"""
	if len(units) == 0:
		return []
	if len(units) <= size:
		return [
			Window(
				window_id=f"{book_id}-c{chapter_no:03d}-w000",
				book_id=book_id,
				chapter_no=chapter_no,
				units=tuple(units),
			)
		]
	last_start = len(units) - size
	starts = sorted(set(list(range(0, last_start + 1, step)) + [last_start]))
	windows: list[Window] = []
	for seq, start in enumerate(starts):
		windows.append(
			Window(
				window_id=f"{book_id}-c{chapter_no:03d}-w{seq:03d}",
				book_id=book_id,
				chapter_no=chapter_no,
				units=tuple(units[start : start + size]),
			)
		)
	return windows
