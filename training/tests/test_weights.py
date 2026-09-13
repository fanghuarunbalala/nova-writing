"""weights 契约测试：构造校验、save/load round-trip、score 矩阵语义。"""

from __future__ import annotations

import numpy as np
import pytest

from prose_gate.weights import Weights, load_weights, save_weights


def make_weights(embedding_dim: int = 3, n_features: int = 2, n_labels: int = 2) -> Weights:
	return Weights(
		labels_version="v1",
		labels=[f"lab{j}" for j in range(n_labels)],
		feature_keys=[f"feat{j}" for j in range(n_features)],
		embedding_dim=embedding_dim,
		W=[[0.0] * embedding_dim + [1.0, 0.0] for _ in range(n_labels)],
		b=[0.0] * n_labels,
		feature_norm={"mu": [0.0] * n_features, "sd": [1.0] * n_features},
		thresholds=[0.5] * n_labels,
		emotion_w=[0.5] * embedding_dim + [0.0, 0.0],
		emotion_b=[0.0, 1.0, 2.0],
		train_data={"nTrain": 10},
	)


def test_validate_rejects_bad_shapes():
	bad = make_weights()
	bad.W = [[0.0] * 3]  # 列数不符
	with pytest.raises(ValueError):
		bad.validate()


def test_validate_rejects_bad_emotion_head():
	bad = make_weights()
	bad.emotion_w = [0.0] * 4  # 列数不符（应为 embedding_dim + n_features = 5）
	with pytest.raises(ValueError):
		bad.validate()
	bad = make_weights()
	bad.emotion_b = [0.0, 1.0]  # 档数不符（应为 3）
	with pytest.raises(ValueError):
		bad.validate()
	bad = make_weights()
	bad.emotion_b = [2.0, 1.0, 0.0]  # 降序破坏 P(≥k) 单调
	with pytest.raises(ValueError):
		bad.validate()
	bad = make_weights()
	bad.emotion_w = []  # 一者空一者有 → 拒绝
	with pytest.raises(ValueError):
		bad.validate()


def test_save_load_roundtrip(tmp_path):
	weights = make_weights()
	path = tmp_path / "w.json"
	save_weights(weights, path)
	loaded = load_weights(path)
	assert loaded.labels == weights.labels
	assert np.allclose(loaded.W, weights.W)
	assert loaded.thresholds == weights.thresholds
	assert np.allclose(loaded.emotion_w, weights.emotion_w)
	assert loaded.emotion_b == weights.emotion_b


def test_score_emotion_cumulative_monotonic():
	weights = make_weights(embedding_dim=3, n_features=2, n_labels=1)
	embeddings = np.array([[2.0, -1.0, 0.5], [-2.0, 1.0, -0.5]])
	features = np.array([[1.0, 0.0], [0.0, 1.0]])
	cum = weights.score_emotion(embeddings, features)
	assert cum.shape == (2, 3)
	# 同段 P(≥1) ≥ P(≥2) ≥ P(≥3)（CORAL 升序阈值保证）
	assert (cum[:, 0] >= cum[:, 1] - 1e-12).all()
	assert (cum[:, 1] >= cum[:, 2] - 1e-12).all()
	# 嵌入第 1 维权重 0.5、特征不进头：行 0 分数高于行 1 → 各档概率更高
	assert (cum[0] > cum[1]).all()
	expect = weights.emotion_line(embeddings, features)
	assert expect.shape == (2,)
	assert np.allclose(expect, cum.sum(axis=1))


def test_score_matrix_concat_order_and_sigmoid():
	weights = make_weights(embedding_dim=3, n_features=2, n_labels=1)
	weights.W = [[1.0, 0, 0, 5.0, 0.0]]  # 嵌入第 1 维 + 特征第 1 维（拼接序：嵌入在前）
	embeddings = np.array([[2.0, 0, 0]])
	features = np.array([[1.0, 0]])
	prob = weights.score_matrix(embeddings, features)[0, 0]
	expected = 1.0 / (1.0 + np.exp(-(2.0 * 1.0 + 1.0 * 5.0)))  # logit = 2 + 5 = 7
	assert prob == pytest.approx(expected)


def test_feature_norm_applied_before_concat():
	weights = make_weights(embedding_dim=1, n_features=1, n_labels=1)
	weights.W = [[0.0, 5.0]]
	weights.feature_norm = {"mu": [2.0], "sd": [2.0]}
	# 特征 4 → 归一化 (4-2)/2 = 1 → logit 5
	prob = weights.score_matrix(np.array([[0.0]]), np.array([[4.0]]))[0, 0]
	assert prob == pytest.approx(1 / (1 + np.exp(-5.0)))


def test_current_labels_match():
	from prose_gate.weights import feature_keys_match_current
	from prose_gate.features import FEATURE_KEYS
	from prose_gate.labels import LABEL_KEYS, LABELS_VERSION

	full = Weights(
		labels_version=LABELS_VERSION,
		labels=list(LABEL_KEYS),
		feature_keys=list(FEATURE_KEYS),
		embedding_dim=512,
		W=[[0.1] * (512 + len(FEATURE_KEYS)) for _ in LABEL_KEYS],
		b=[0.0] * len(LABEL_KEYS),
		feature_norm={"mu": [0.0] * len(FEATURE_KEYS), "sd": [1.0] * len(FEATURE_KEYS)},
	)
	full.validate()
	assert full.matches_current_labels()
	assert feature_keys_match_current(full)
