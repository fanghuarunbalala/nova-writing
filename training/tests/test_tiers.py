"""编码器档位（预留接口）测试：注册表规格、weights.encoder 声明与校验。"""

from __future__ import annotations

import numpy as np
import pytest

from prose_gate.embed import MODEL_TIERS, tier_spec
from prose_gate.weights import Weights, load_weights, save_weights


def test_tier_registry_specs():
	assert set(MODEL_TIERS) >= {"small", "large"}
	for name, spec in MODEL_TIERS.items():
		assert {"modelDir", "maxTokens", "dim"} <= set(spec)
	# large 装得下整章：2000-4000 字 ≈ 峰值 ~5K token（含逐段 [SEP]），8192 上限留余量
	assert MODEL_TIERS["large"]["maxTokens"] >= 6000
	assert MODEL_TIERS["large"]["dim"] > MODEL_TIERS["small"]["dim"]


def test_tier_spec_rejects_unknown():
	with pytest.raises(ValueError):
		tier_spec("huge")


def make_with_encoder(dim: int = 3) -> Weights:
	from prose_gate.embed import MODEL_TIERS

	spec = dict(MODEL_TIERS["small"])
	spec["dim"] = dim
	return Weights(
		labels_version="v2",
		labels=["a"],
		feature_keys=["f1"],
		embedding_dim=dim,
		W=[[0.0] * (dim + 1)],
		b=[0.0],
		feature_norm={"mu": [0.0], "sd": [1.0]},
		encoder={"tier": "small", **spec},
	)


def test_encoder_block_roundtrip(tmp_path):
	weights = make_with_encoder(3)
	path = tmp_path / "w.json"
	save_weights(weights, path)
	loaded = load_weights(path)
	assert loaded.encoder["tier"] == "small"
	assert loaded.encoder["modelDir"] == "bge-small-zh-v1.5"
	assert loaded.encoder["maxTokens"] == 480


def test_encoder_dim_must_match_embedding_dim():
	bad = make_with_encoder(dim=3)
	bad.encoder = {**bad.encoder, "dim": 1024}
	with pytest.raises(ValueError, match="不符"):
		bad.validate()


def test_encoder_missing_fields_rejected():
	bad = make_with_encoder()
	bad.encoder = {"tier": "small"}
	with pytest.raises(ValueError, match="缺字段"):
		bad.validate()


def test_encoder_absent_is_legacy_ok():
	weights = make_with_encoder()
	weights.encoder = {}
	weights.validate()  # 旧文件无 encoder 块：按 small 处理，不报错
	probs = weights.score_matrix(np.zeros((1, 3)), np.zeros((1, 1)))
	assert probs.shape == (1, 1)
