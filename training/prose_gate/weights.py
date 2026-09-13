"""weights JSON 契约（语言无关；未来 TS runtime M3 按同契约加载）。

z = [h(embedding_dim) ‖ x_normed(len(feature_keys))]，
缺陷头：logit_j = W[j]·z + b[j]，P = sigmoid(logit)，n×7 段级独立概率（多标签）。
情绪头（v2 新增，CORAL 有序回归）：score = emotion_w·z，
P(强度 ≥ k) = sigmoid(score − emotion_b[k])，k=1..3；biases 升序保证累积概率单调。
期望强度 E = Σ_k P(≥k)；窗口平直 = 情绪线极差 ≤ labels.FLAT_RANGE_MAX（派生，不在权重内）。
encoder（可选块）：声明训练用的编码器档位（embed.MODEL_TIERS），TS/推理侧据此选模型
与 maxTokens；缺省空 = 未声明（按 small 处理）。
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .features import FEATURE_KEYS
from .labels import EMOTION_MAX, LABEL_KEYS, LABELS_VERSION

WEIGHTS_SCHEMA = 2


@dataclass
class Weights:
	"""判官权重产物。W 形状 (labels, embedding_dim + features)；feature_norm 为训练集统计。
	emotion_w/emotion_b 为情绪有序头（共享打分 + 升序阈值，缺省为空 = 无情绪头）。"""

	labels_version: str
	labels: list[str]
	feature_keys: list[str]
	embedding_dim: int
	W: list[list[float]]
	b: list[float]
	feature_norm: dict = field(default_factory=dict)  # {"mu": [...], "sd": [...]}
	thresholds: list[float] = field(default_factory=list)
	emotion_w: list[float] = field(default_factory=list)
	emotion_b: list[float] = field(default_factory=list)  # 长度 3（对应 ≥1/≥2/≥3），升序
	encoder: dict = field(default_factory=dict)  # {"tier","modelDir","maxTokens","dim"}，缺省空 = 未声明
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
		has_w, has_b = bool(self.emotion_w), bool(self.emotion_b)
		if has_w != has_b:
			raise ValueError("emotion_w/emotion_b 必须同时提供或同时为空")
		if has_b:
			if len(self.emotion_w) != expected_cols:
				raise ValueError(f"emotion_w 长度应为 {expected_cols}")
			if len(self.emotion_b) != EMOTION_MAX:
				raise ValueError(f"emotion_b 长度应为 {EMOTION_MAX}")
			if any(self.emotion_b[k] > self.emotion_b[k + 1] for k in range(EMOTION_MAX - 1)):
				raise ValueError("emotion_b 应升序（保证 P(≥k) 随 k 单调不增）")
		if self.encoder:
			missing = {"tier", "modelDir", "maxTokens", "dim"} - set(self.encoder)
			if missing:
				raise ValueError(f"encoder 缺字段：{sorted(missing)}")
			if int(self.encoder["dim"]) != self.embedding_dim:
				raise ValueError(
					f"encoder.dim={self.encoder['dim']} 与 embedding_dim={self.embedding_dim} 不符"
				)

	def matches_current_labels(self) -> bool:
		return list(self.labels) == list(LABEL_KEYS) and self.labels_version == LABELS_VERSION

	def _z(self, embeddings: np.ndarray, features: np.ndarray) -> np.ndarray:
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
		return np.concatenate([embeddings, features], axis=1)

	def score_matrix(self, embeddings: np.ndarray, features: np.ndarray) -> np.ndarray:
		"""(n, embedding_dim) 嵌入 + (n, len(feature_keys)) 原始特征 → (n, labels) 缺陷概率。"""
		z = self._z(embeddings, features)
		logits = z @ np.array(self.W).T + np.array(self.b)
		return 1.0 / (1.0 + np.exp(-logits))

	def score_emotion(self, embeddings: np.ndarray, features: np.ndarray) -> np.ndarray:
		"""→ (n, 3) 累积概率 P(强度≥1/≥2/≥3)；无情绪头时抛错。"""
		if not self.emotion_b:
			raise ValueError("该权重无情绪头（emotion_b 为空）")
		z = self._z(embeddings, features)
		score = z @ np.array(self.emotion_w)
		return 1.0 / (1.0 + np.exp(-(score[:, None] - np.array(self.emotion_b)[None, :])))

	def emotion_line(self, embeddings: np.ndarray, features: np.ndarray) -> np.ndarray:
		"""→ (n,) 期望强度 E = Σ_k P(≥k)（0-3 连续值，供派生平直/转折）。"""
		return self.score_emotion(embeddings, features).sum(axis=1)


def save_weights(w: Weights, path: str | Path) -> None:
	w.validate()
	path = Path(path)
	path.parent.mkdir(parents=True, exist_ok=True)
	payload = {"schema": WEIGHTS_SCHEMA, **vars(w)}
	path.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")


def load_weights(path: str | Path) -> Weights:
	payload = json.loads(Path(path).read_text(encoding="utf-8"))
	if payload.get("schema") != WEIGHTS_SCHEMA:
		raise ValueError(f"不支持的 weights schema：{payload.get('schema')}（当前 {WEIGHTS_SCHEMA}）")
	fields = {f.name for f in Weights.__dataclass_fields__.values()}  # type: ignore[attr-defined]
	weights = Weights(**{k: v for k, v in payload.items() if k in fields})
	weights.validate()
	return weights


def feature_keys_match_current(w: Weights) -> bool:
	return list(w.feature_keys) == list(FEATURE_KEYS)
