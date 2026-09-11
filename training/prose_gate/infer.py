"""推理验证：weights + 冻结编码器 → 窗口 n×8 概率（训练侧冒烟/校验用）。

M3（runtime 门控）时 TS 侧按 weights.py 契约重实现加载与本打分逻辑。
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .features import paragraph_features
from .windowing import SentenceUnit, Window, re_split_paragraphs
from .weights import Weights, load_weights


class ProseGateModel:
	"""判官推理封装：score(texts) → 每段 8 标签概率。"""

	def __init__(self, weights: Weights, model_dir: str | Path | None = None) -> None:
		self.weights = weights
		self._embedder = None
		self._model_dir = model_dir

	def _ensure_embedder(self):
		if self._embedder is None:
			if self._model_dir is None:
				raise ValueError("构造时需提供 model_dir 才能计算嵌入")
			from .embed import SegmentEmbedder

			self._embedder = SegmentEmbedder(self._model_dir)
		return self._embedder

	def score(self, texts: list[str]) -> list[dict[str, float]]:
		"""窗口段文本 → [{key: P}, ...]，逐段独立概率（多标签）。"""
		import numpy as np

		embeddings = self._ensure_embedder().embed_window(texts)
		features = np.array(paragraph_features(texts), dtype=np.float64)
		probs = self.weights.score_matrix(embeddings, features)
		return [
			{key: float(probs[i, j]) for j, key in enumerate(self.weights.labels)}
			for i in range(len(texts))
		]

	def score_window(self, window: Window) -> list[dict[str, float]]:
		return self.score(list(window.texts))

	@classmethod
	def load(cls, weights_path: str | Path, model_dir: str | Path | None = None) -> "ProseGateModel":
		return cls(load_weights(weights_path), model_dir)


def main(argv: list[str] | None = None) -> int:
	parser = argparse.ArgumentParser(description="推理冒烟：一段多行文本 → n×8 概率")
	parser.add_argument("--weights", type=Path, default=Path("artifacts/prose-gate-weights.v1.json"))
	parser.add_argument("--model-dir", type=Path, default=Path("models/bge-small-zh-v1.5"))
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
