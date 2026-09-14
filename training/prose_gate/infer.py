"""推理验证：weights + 冻结编码器 → 窗口 n×7 缺陷概率 + n 情绪线（训练侧冒烟/校验用）。

编码器按 weights.encoder 声明自动选档（tier → models/<modelDir> + maxTokens）；
显式 model_dir 参数优先。M3（runtime 门控）时 TS 侧按 weights.py 契约重实现加载与本打分逻辑。
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .features import paragraph_features
from .windowing import SentenceUnit, Window, re_split_paragraphs
from .weights import Weights, load_weights


class ProseGateModel:
	"""判官推理封装：score(texts) → 每段 7 标签概率 + 情绪期望强度。"""

	def __init__(self, weights: Weights, model_dir: str | Path | None = None) -> None:
		self.weights = weights
		self._embedder = None
		self._model_dir = model_dir  # 显式指定优先；缺省从 weights.encoder 解析

	def _ensure_embedder(self):
		if self._embedder is None:
			model_dir = self._model_dir
			max_tokens = None
			if model_dir is None:
				enc = self.weights.encoder
				if not enc:
					raise ValueError("weights 未声明 encoder 且未提供 model_dir")
				from .embed import tier_spec

				spec = tier_spec(str(enc["tier"]))
				model_dir = Path("models") / spec["modelDir"]
				max_tokens = int(spec["maxTokens"])
			from .embed import SegmentEmbedder

			self._embedder = SegmentEmbedder(model_dir)
			self._max_tokens = max_tokens
		return self._embedder

	def score(self, texts: list[str]) -> list[dict[str, float]]:
		"""窗口段文本 → [{key: P, ..., "emotion": E}, ...]，逐段独立概率（多标签）。"""
		import numpy as np

		embedder = self._ensure_embedder()
		embeddings = (
			embedder.embed_window(texts, max_tokens=self._max_tokens)
			if getattr(self, "_max_tokens", None)
			else embedder.embed_window(texts)
		)
		features = np.array(paragraph_features(texts), dtype=np.float64)
		probs = self.weights.score_matrix(embeddings, features)
		rows = [
			{key: float(probs[i, j]) for j, key in enumerate(self.weights.labels)}
			for i in range(len(texts))
		]
		if self.weights.emotion_b:
			emotion = self.weights.emotion_line(embeddings, features)
			for i, row in enumerate(rows):
				row["emotion"] = float(emotion[i])
		return rows

	def score_window(self, window: Window) -> list[dict[str, float]]:
		return self.score(list(window.texts))

	@classmethod
	def load(cls, weights_path: str | Path, model_dir: str | Path | None = None) -> "ProseGateModel":
		return cls(load_weights(weights_path), model_dir)


def main(argv: list[str] | None = None) -> int:
	parser = argparse.ArgumentParser(description="推理冒烟：一段多行文本 → n×7 概率 + 情绪线")
	parser.add_argument("--weights", type=Path, default=Path("artifacts/prose-gate-weights.v2.json"))
	parser.add_argument("--model-dir", type=Path, default=None, help="缺省按 weights.encoder 档位解析")
	parser.add_argument("--text", required=True, help="多行文本，每行一段（\\n 分隔）")
	args = parser.parse_args(argv)

	model = ProseGateModel.load(args.weights, args.model_dir)
	units = re_split_paragraphs(args.text.replace("\\n", "\n"))
	window = Window("adhoc", "adhoc", 1, tuple(units))
	probs = model.score_window(window)
	print(json.dumps(probs, ensure_ascii=False, indent=1))
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
