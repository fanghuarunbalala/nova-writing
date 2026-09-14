"""schema v2 测试：7 缺陷标签 + 情绪线派生规则（平直/转折）。"""

from __future__ import annotations

from prose_gate.labels import (
	LABEL_KEYS,
	LABELS_VERSION,
	clamp_emotion,
	derive_flat,
	derive_turns,
)


def test_v2_seven_defect_labels():
	assert LABELS_VERSION == "v3"
	assert len(LABEL_KEYS) == 11
	assert "flatAffect" not in LABEL_KEYS  # 已移除：平直改由情绪线派生
	# v3 新增（试标期完备性审计四观察）
	for key in ("logicJump", "awkwardDiction", "voiceFlat", "surfaceError"):
		assert key in LABEL_KEYS


def test_derive_flat_covers_low_and_high_plateau():
	assert derive_flat([0, 0, 0, 0]) is True  # 低位平直（全程死水）
	assert derive_flat([2, 2, 2, 2]) is True  # 高位平直（全程爆发=没有爆发）
	assert derive_flat([0, 1, 0, 1]) is True  # 微澜不动（极差 1 仍算平）
	assert derive_flat([0, 0, 2, 0]) is False  # 有起伏
	assert derive_flat([]) is False


def test_derive_turns():
	assert derive_turns([0, 0, 2, 2, 1]) == [0, 2, 0, -1]
	assert derive_turns([3, 3, 3]) == [0, 0]


def test_clamp_emotion():
	assert clamp_emotion(9) == 3
	assert clamp_emotion(-2) == 0
	assert clamp_emotion("很激动") == 0
	assert clamp_emotion(None) == 0
	assert clamp_emotion(2) == 2
