"""weights JSON 契约（语言无关；未来 TS runtime M3 按同契约加载）。

z = [h(embedding_dim) ‖ x_normed(len(feature_keys))]，
logit_j = W[j]·z + b[j]，P = sigmoid(logit)，n×8 段级独立概率（多标签）。
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .features import FEATURE_KEYS
from .labels import LABEL_KEYS, LABELS_VERSION

WEIGHTS_SCHEMA = 1


@dataclass
class Weights:
	"""判官权重产物。W 形状 (labels, embedding_dim + features)；feature_norm 为训练集统计。"""

	labels_version: str
	labels: list[str]
	feature_keys: list[str]
	embedding_dim: int
	W: list[list[float]]
	b: list[float]
	feature_norm: dict = field(default_factory=dict)  # {"mu": [...], "sd": [...]}
	thresholds: list[float] = field(default_factory=list)
	train_data: dict = field(default_factory=dict)  # 训练数据/指标 manifest

	def validate(self) -> None:
		n_labels = len(self.labels)
		if n_labels == 0 or len(self.feature_keys) == 0:
			raise ValueError("labels/feature_keys 不能为空")
		expected_cols = self.embedding_dim + len(self.feature_keys)
		if len(self.W) != n_labels or any(len(row) != expected_cols for row in self.W):
			raise ValueError(f"W 形状应为 ({n_labels}, {expected_cols})")
		if len(self.b) != n_labels:
			raise ValueError(f"b 长度应为 {n_labels}")
		if self.thresholds and len(self.thresholds) != n_labels:
			raise ValueError(f"thresholds 长度应为 {n_labels}")
		mu = self.feature_norm.get("mu", [])
		sd = self.feature_norm.get("sd", [])
		if len(mu) != len(self.feature_keys) or len(sd) != len(self.feature_keys):
			raise ValueError(f"feature_norm.mu/sd 长度应为 {len(self.feature_keys)}")

	def matches_current_labels(self) -> bool:
		return list(self.labels) == list(LABEL_KEYS) and self.labels_version == LABELS_VERSION

	def score_matrix(self, embeddings: np.ndarray, features: np.ndarray) -> np.ndarray:
		"""(n, embedding_dim) 嵌入 + (n, len(feature_keys)) 原始特征 → (n, labels) 概率。"""
		embeddings = np.asarray(embeddings, dtype=np.float64)
		features = np.asarray(features, dtype=np.float64)
		if embeddings.shape[1] != self.embedding_dim:
			raise ValueError(f"嵌入维度应为 {self.embedding_dim}")
		if features.shape[1] != len(self.feature_keys):
			raise ValueError(f"特征维度应为 {len(self.feature_keys)}")
		if self.feature_norm:
			mu = np.array(self.feature_norm["mu"])
			sd = np.array(self.feature_norm["sd"])
			features = (features - mu) / (sd + 1e-9)
		z = np.concatenate([embeddings, features], axis=1)
		logits = z @ np.array(self.W).T + np.array(self.b)
		return 1.0 / (1.0 + np.exp(-logits))


def save_weights(w: Weights, path: str | Path) -> None:
	w.validate()
	path = Path(path)
	path.parent.mkdir(parents=True, exist_ok=True)
	payload = {"schema": WEIGHTS_SCHEMA, **vars(w)}
	path.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")


def load_weights(path: str | Path) -> Weights:
	payload = json.loads(Path(path).read_text(encoding="utf-8"))
	if payload.get("schema") != WEIGHTS_SCHEMA:
		raise ValueError(f"不支持的 weights schema：{payload.get('schema')}")
	fields = {f.name for f in Weights.__dataclass_fields__.values()}  # type: ignore[attr-defined]
	weights = Weights(**{k: v for k, v in payload.items() if k in fields})
	weights.validate()
	return weights


def feature_keys_match_current(w: Weights) -> bool:
	return list(w.feature_keys) == list(FEATURE_KEYS)
