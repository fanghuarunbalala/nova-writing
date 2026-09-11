"""统计特征测试：各检测器命中构造样例、flat 窗口 x8≈0、特征序固定。"""

from __future__ import annotations

from prose_gate.features import FEATURE_KEYS, paragraph_features

IDX = {k: i for i, k in enumerate(FEATURE_KEYS)}


def test_feature_keys_order_frozen():
	assert FEATURE_KEYS == (
		"len_deviation",
		"opening_similarity",
		"cliche_hits",
		"idiom_hits",
		"modifier_density",
		"clause_len_var",
		"emotion_intensity",
		"window_emotion_var",
	)


def test_cliche_hit_counts_longest_match_no_nesting():
	rows = paragraph_features(["他嘴角勾起一抹冷笑。", "普通白描一句。"])
	# "嘴角勾起一抹冷笑" 命中 1 次（嵌套的"嘴角勾起/勾起一抹/冷笑"不再计）
	assert rows[0][IDX["cliche_hits"]] == 1.0
	assert rows[1][IDX["cliche_hits"]] == 0.0


def test_idiom_and_modifier_density():
	rows = paragraph_features(
		["他不动声色，运筹帷幄。", "他非常愤怒地盯着那个东西。", "他走了。"]
	)
	assert rows[0][IDX["idiom_hits"]] == 2.0
	assert rows[0][IDX["modifier_density"]] == 0.0
	assert rows[1][IDX["modifier_density"]] > 0.0  # "非常" + "地/的" 类修饰
	assert rows[1][IDX["modifier_density"]] > rows[2][IDX["modifier_density"]]


def test_opening_similarity_with_previous():
	rows = paragraph_features(["他推门。", "他坐下。", "雨停了。"])
	assert rows[0][IDX["opening_similarity"]] == 0.0  # 首段无前段
	assert rows[1][IDX["opening_similarity"]] == 0.0  # "他推" vs "他坐" 前 2 字不同
	assert rows[2][IDX["opening_similarity"]] == 0.0


def test_opening_similarity_uses_first_two_chars():
	# 前 2 字完全相同才计 1
	rows = paragraph_features(["他推开了门。", "他推不开门。"])
	assert rows[1][IDX["opening_similarity"]] == 1.0


def test_flat_window_zero_variance():
	flat = ["他很愤怒。"] * 8
	rows = paragraph_features(flat)
	assert all(r[IDX["window_emotion_var"]] == 0.0 for r in rows)
	assert all(r[IDX["len_deviation"]] == 0.0 for r in rows)  # 等长 → 无偏离


def test_varied_window_positive_variance():
	varied = ["他很愤怒！", "他走了。", "夜深了，灯芯忽然爆了个火花，他猛地站起。", "雨。"]
	rows = paragraph_features(varied)
	assert rows[0][IDX["window_emotion_var"]] > 0.0
	assert max(r[IDX["emotion_intensity"]] for r in rows) == rows[0][IDX["emotion_intensity"]]


def test_uniform_length_low_deviation():
	等长 = ["他拿起了茶杯。", "她放下了账本。", "灯芯跳了一下。"]
	rows = paragraph_features(等长)
	assert all(r[IDX["len_deviation"]] < 0.1 for r in rows)


def test_clause_variation_detects_monotone_inside_paragraph():
	monotone = "他拿杯，他放下，他坐下。"  # 三个子句等长
	rich = "他拿杯，放下账本和算筹，坐。"
	assert paragraph_features([monotone])[0][IDX["clause_len_var"]] < paragraph_features(
		[rich]
	)[0][IDX["clause_len_var"]]
