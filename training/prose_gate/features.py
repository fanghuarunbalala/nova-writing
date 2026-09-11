"""8 维段级上下文统计特征（PRD F4，featureKeys 固定序）。

纯词表+正则实现，无分词依赖；x_i 描述"窗口中第 i 段"，其中 x8 为窗口共享量
（flatAffect 的直接统计线索）。与嵌入拼接进共享头：z = [h(512) ‖ x_normed(8)]。
"""

from __future__ import annotations

import re
from typing import Sequence

from .lexicons import (
	CLICHE_PHRASES,
	EMOTION_LEXICON,
	FOUR_CHAR_IDIOMS,
	INTENSIFIER_ADVERBS,
)

FEATURE_KEYS: tuple[str, ...] = (
	"len_deviation",       # x1 段长偏离窗口均值
	"opening_similarity",  # x2 与前段开头相似（前 2 字相同 → 1，首段 0）
	"cliche_hits",         # x3 套话词表命中数（最长匹配去嵌套）
	"idiom_hits",          # x4 四字格/成语计数
	"modifier_density",    # x5 修饰词密度（程度副词命中 + "的"计数）/ 段长
	"clause_len_var",      # x6 段内子句长变异（变异系数）
	"emotion_intensity",   # x7 情绪强度 proxy（情感词强度和 + 感叹号数）
	"window_emotion_var",  # x8 窗口情绪方差（各段 x7 的总体方差，逐段共享）
)

_CLAUSE_SPLIT = re.compile(r"[，。！？；：、…⋯—\-]+")
_EPS = 1e-6


def _count_longest_matches(text: str, phrases: frozenset[str]) -> int:
	"""统计词表命中数：长词优先、命中区间不重叠（避免嵌套短语重复计数）。"""
	covered = [False] * len(text)
	hits = 0
	for phrase in sorted(phrases, key=len, reverse=True):
		start = text.find(phrase)
		while start != -1:
			if not any(covered[start : start + len(phrase)]):
				for i in range(start, start + len(phrase)):
					covered[i] = True
				hits += 1
			start = text.find(phrase, start + 1)
	return hits


def _emotion_intensity(text: str) -> float:
	"""情绪强度 proxy：情感词强度绝对值求和 + 感叹号计数。"""
	score = 0.0
	for word, (_valence, intensity) in EMOTION_LEXICON.items():
		if word in text:
			score += intensity
	score += text.count("！") + text.count("!")
	return score


def _clause_len_variation(text: str) -> float:
	"""段内子句长变异系数（标准差/均值）：句内节奏单一 → ≈0。"""
	clauses = [c for c in _CLAUSE_SPLIT.split(text) if c.strip() != ""]
	if len(clauses) < 2:
		return 0.0
	lengths = [len(c) for c in clauses]
	mean = sum(lengths) / len(lengths)
	var = sum((l - mean) ** 2 for l in lengths) / len(lengths)
	return (var ** 0.5) / (mean + _EPS)


def paragraph_features(window_texts: Sequence[str]) -> list[list[float]]:
	"""窗口（有序段文本）→ n×8 特征矩阵，列序 = FEATURE_KEYS。"""
	n = len(window_texts)
	if n == 0:
		return []
	lens = [len(t) for t in window_texts]
	mean_len = sum(lens) / n
	std_len = (sum((l - mean_len) ** 2 for l in lens) / n) ** 0.5
	emotions = [_emotion_intensity(t) for t in window_texts]
	mean_em = sum(emotions) / n
	var_em = sum((e - mean_em) ** 2 for e in emotions) / n

	rows: list[list[float]] = []
	for i, text in enumerate(window_texts):
		opening_similarity = 0.0
		if i > 0 and len(text) >= 2 and len(window_texts[i - 1]) >= 2:
			opening_similarity = 1.0 if text[:2] == window_texts[i - 1][:2] else 0.0
		idiom_hits = sum(1 for idiom in FOUR_CHAR_IDIOMS if idiom in text)
		modifier = sum(1 for adv in INTENSIFIER_ADVERBS if adv in text) + text.count("的")
		rows.append(
			[
				abs(lens[i] - mean_len) / (std_len + _EPS),
				opening_similarity,
				float(_count_longest_matches(text, CLICHE_PHRASES)),
				float(idiom_hits),
				modifier / max(lens[i], 1),
				_clause_len_variation(text),
				emotions[i],
				var_em,
			]
		)
	return rows
