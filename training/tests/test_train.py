"""训练器测试：torch 合成可分数据收敛、指标与阈值校准（无 torch 时跳过）。"""

from __future__ import annotations

import numpy as np
import pytest

torch = pytest.importorskip("torch", reason="未安装 torch（联网后跑 setup 脚本）")

from prose_gate.labels import LABEL_KEYS  # noqa: E402
from prose_gate.train import (  # noqa: E402
	calibrate_thresholds,
	group_split,
	make_synthetic,
	roc_auc,
	train_head,
)


def test_roc_auc_perfect_and_random():
	y = np.array([0, 0, 1, 1])
	assert roc_auc(y, np.array([0.1, 0.2, 0.8, 0.9])) == pytest.approx(1.0)
	# 正例两胜一负一平局：p=[0.9,0.1,0.2,0.95] → 3/4 对胜 = 0.75
	assert roc_auc(y, np.array([0.9, 0.1, 0.2, 0.95])) == pytest.approx(0.75)
	assert roc_auc(y, np.array([0.5, 0.5, 0.5, 0.5])) == pytest.approx(0.5)  # 全并列
	assert roc_auc(np.array([1, 1]), np.array([0.3, 0.4])) == 0.5  # 单类


def test_calibrate_thresholds_precision_fallback():
	# 可达 precision 目标：取最小满足阈值（0.85 处 precision=1.0）
	y = np.array([[1], [1], [0], [0]])
	probs = np.array([[0.95], [0.85], [0.4], [0.3]])
	tau = calibrate_thresholds(probs, y, target_precision=0.9)[0]
	assert tau == pytest.approx(0.85)
	# 不可达：最高分是负例，任何阈值 precision ≤ 0.67 → 回退 best-F1（0.7，F1=0.8）且 ≥0.5
	y_bad = np.array([[0], [1], [1], [0]])
	probs_bad = np.array([[0.9], [0.8], [0.7], [0.1]])
	tau_bad = calibrate_thresholds(probs_bad, y_bad, target_precision=0.99)[0]
	assert tau_bad >= 0.5


def test_group_split_no_leakage():
	groups = np.array(["a"] * 10 + ["b"] * 10 + ["c"] * 10 + ["d"] * 10)
	train, val, test = group_split(groups, seed=0)
	assert train.sum() + val.sum() + test.sum() == len(groups)
	assert (train & val).sum() == 0 and (train & test).sum() == 0 and (val & test).sum() == 0
	# 泄漏检查：每个组的行整体只落进一个集合
	for g in np.unique(groups):
		membership = [bool(mask[groups == g].any()) for mask in (train, val, test)]
		assert sum(membership) == 1, f"组 {g} 跨集合：{membership}"


def test_synthetic_end_to_end_converges():
	# n_windows=300 → 2400 段；520 维下样本太小时会过拟合（2400 行 + l2=1e-2 收敛到 0.92+）
	emb, feat, labels, emotion, groups = make_synthetic(n_windows=300, seed=7)
	weights, metrics = train_head(emb, feat, labels, groups, emotion=emotion, seed=7)
	assert metrics["valMacroAuc"] > 0.9
	assert len(weights.thresholds) == len(LABEL_KEYS)
	assert weights.embedding_dim == emb.shape[1]
	# 训练后对合成数据打分：正例概率应显著高于负例
	probs = weights.score_matrix(emb, feat)
	j = 0
	pos_mean = probs[labels[:, j] == 1, j].mean()
	neg_mean = probs[labels[:, j] == 0, j].mean()
	assert pos_mean > neg_mean + 0.3
	# 情绪有序头：阈值升序、累积概率单调、期望强度与真值强相关、MAE 合理
	assert len(weights.emotion_b) == 3
	assert weights.emotion_b == sorted(weights.emotion_b)
	cum = weights.score_emotion(emb, feat)
	assert ((cum[:, 0] >= cum[:, 1] - 1e-9) & (cum[:, 1] >= cum[:, 2] - 1e-9)).all()
	expect = cum.sum(axis=1)
	corr = np.corrcoef(expect, emotion.astype(float))[0, 1]
	assert corr > 0.8, corr
	assert metrics["emotion"]["mae"] < 0.5


def test_train_head_without_emotion_omits_head():
	emb, feat, labels, _emotion, groups = make_synthetic(n_windows=50, seed=3)
	weights, metrics = train_head(emb, feat, labels, groups, emotion=None, seed=3)
	assert weights.emotion_w == [] and weights.emotion_b == []
	assert "emotion" not in metrics


def test_train_head_rows_with_missing_emotion_are_masked():
	emb, feat, labels, emotion, groups = make_synthetic(n_windows=100, seed=5)
	emotion_masked = emotion.copy()
	emotion_masked[: len(emotion) // 2] = -1  # 半数行缺失（v1 遗留记录）
	train_mask, _val, _test = group_split(groups, seed=5)
	weights, metrics = train_head(emb, feat, labels, groups, emotion=emotion_masked, seed=5)
	assert len(weights.emotion_b) == 3
	assert metrics["emotion"]["nTrain"] == int((train_mask & (emotion_masked >= 0)).sum())
