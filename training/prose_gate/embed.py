"""段级嵌入提取：冻结 bge-small-zh-v1.5 → 每窗口 n×512（PRD F4）。

编码序列：[CLS] t(p1) [SEP] t(p2) [SEP] …（逐段无特殊符 tokenize 后拼接，span 精确）；
前向取 last_hidden_state，按段 span 均值池化 + 段级 L2 归一（跨段 attention 保留——
这是"判关系"标签的上下文机制）。torch/transformers 延迟导入：无网络环境可跑其余模块。
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

MAX_TOKENS = 480  # 512 上限留 [CLS]/[SEP] 余量（PRD F4）


class SegmentEmbedder:
	"""冻结编码器段级嵌入器。model_dir 为本地 HF 格式模型目录（scripts/fetch_model.py）。"""

	def __init__(self, model_dir: str | Path, device: str = "cpu") -> None:
		import torch
		from transformers import AutoModel, AutoTokenizer

		self._torch = torch
		model_dir = str(model_dir)
		self.tokenizer = AutoTokenizer.from_pretrained(model_dir)
		self.model = AutoModel.from_pretrained(model_dir).to(device).eval()
		self.device = device
		self.hidden_dim = int(self.model.config.hidden_size)

	def embed_window(self, texts: list[str], max_tokens: int = MAX_TOKENS) -> np.ndarray:
		"""窗口段文本 → (n, hidden) float32，段级 L2 归一；超长截断（后段可能被削空 → 零向量）。"""
		torch = self._torch
		cls_id = self.tokenizer.cls_token_id
		sep_id = self.tokenizer.sep_token_id
		ids: list[list[int]] = []
		for text in texts:
			encoded = self.tokenizer(text, add_special_tokens=False)["input_ids"]
			ids.append(list(encoded))

		sequence: list[int] = [cls_id]
		spans: list[tuple[int, int]] = []
		for unit_ids in ids:
			start = len(sequence)
			if start >= max_tokens:
				spans.append((start, start))  # 被截空的段 → 零向量
				continue
			sequence.extend(unit_ids[: max_tokens - start])
			spans.append((start, len(sequence)))
			sequence.append(sep_id)
		input_ids = torch.tensor([sequence], dtype=torch.long, device=self.device)
		attention = torch.ones_like(input_ids)
		token_type = torch.zeros_like(input_ids)
		with torch.no_grad():
			output = self.model(
				input_ids=input_ids, attention_mask=attention, token_type_ids=token_type
			)
		hidden = output.last_hidden_state[0].cpu().numpy()  # (L, H)
		rows = np.zeros((len(texts), hidden.shape[1]), dtype=np.float32)
		for i, (start, end) in enumerate(spans):
			if end > start:
				vec = hidden[start:end].mean(axis=0)
				norm = float(np.linalg.norm(vec))
				rows[i] = vec / norm if norm > 1e-9 else vec
		return rows


def embed_windows_jsonl(
	windows_path: str | Path,
	model_dir: str | Path,
	out_path: str | Path,
	limit: int | None = None,
) -> dict:
	"""windows.jsonl → embeddings.npz（key=windowId, value=n×512 float32）。返回统计。"""
	embedder = SegmentEmbedder(model_dir)
	data: dict[str, np.ndarray] = {}
	count = 0
	with open(windows_path, encoding="utf-8") as fh:
		for line in fh:
			if limit is not None and count >= limit:
				break
			rec = json.loads(line)
			data[rec["windowId"]] = embedder.embed_window(rec["texts"])
			count += 1
	out_path = Path(out_path)
	out_path.parent.mkdir(parents=True, exist_ok=True)
	np.savez_compressed(out_path, **data)
	return {"windows": count, "out": str(out_path)}


def main(argv: list[str] | None = None) -> int:
	parser = argparse.ArgumentParser(description="windows.jsonl → 段级嵌入 npz")
	parser.add_argument("--windows", type=Path, default=Path("artifacts/windows.jsonl"))
	parser.add_argument("--model-dir", type=Path, default=Path("models/bge-small-zh-v1.5"))
	parser.add_argument("--out", type=Path, default=Path("artifacts/embeddings.npz"))
	parser.add_argument("--limit", type=int, default=None)
	args = parser.parse_args(argv)
	stats = embed_windows_jsonl(args.windows, args.model_dir, args.out, args.limit)
	print(stats)
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
