"""训练器：冻结嵌入 + 8 维特征 → 共享 8 标签 logistic 头（torch，PRD F4/训练策略）。

- 损失：BCEWithLogits + 每标签 pos_weight(cap 20) + L2(1e-4)；
- 切分：按 bookId 分组 8:1:1（同书不跨集，防泄漏）；
- 早停：val 宏 ROC-AUC（Adam 全批）；
- 阈值校准：precision ≥ 0.9 反推 τ，不可达回退 best-F1；
- 产物：prose-gate-weights.v1.json（weights.py 契约）。
torch 延迟导入：无网络环境可跑除本模块外的全部测试。
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np

from .features import FEATURE_KEYS
from .labels import LABELS_VERSION, LABEL_KEYS
from .weights import Weights, save_weights

DEFAULT_L2 = 1e-2
TARGET_PRECISION = 0.9


# ---------- 指标（手写实现，避免 sklearn 依赖） ----------

def roc_auc(y: np.ndarray, p: np.ndarray) -> float:
	"""秩法 ROC-AUC（并列取平均秩）。单类返回 0.5。"""
	y = np.asarray(y)
	p = np.asarray(p)
	pos = int((y == 1).sum())
	neg = int((y == 0).sum())
	if pos == 0 or neg == 0:
		return 0.5
	order = np.argsort(p, kind="mergesort")
	ranks = np.empty(len(p), dtype=np.float64)
	sorted_p = p[order]
	i = 0
	rank = 1.0
	while i < len(p):
		j = i
		while j + 1 < len(p) and sorted_p[j + 1] == sorted_p[i]:
			j += 1
		avg = (rank + rank + (j - i)) / 2.0
		ranks[order[i : j + 1]] = avg
		rank += j - i + 1
		i = j + 1
	return float((ranks[y == 1].sum() - pos * (pos + 1) / 2) / (pos * neg))


def pr_auc(y: np.ndarray, p: np.ndarray) -> float:
	"""PR-AUC（101 点阈值扫描的精度插值平均）。"""
	y = np.asarray(y)
	total_pos = int((y == 1).sum())
	if total_pos == 0:
		return 0.0
	auc = 0.0
	prev_recall = 0.0
	for t in np.linspace(1.0, 0.0, 101):
		pred = p >= t
		tp = int(((pred == 1) & (y == 1)).sum())
		fp = int(((pred == 1) & (y == 0)).sum())
		recall = tp / total_pos
		precision = tp / (tp + fp) if (tp + fp) > 0 else 1.0
		auc += precision * (recall - prev_recall)
		prev_recall = recall
	return float(auc)


def best_f1_threshold(y: np.ndarray, p: np.ndarray) -> tuple[float, float]:
	"""扫描唯一概率值，返回 (best_f1, threshold)。"""
	y = np.asarray(y)
	total_pos = int((y == 1).sum())
	if total_pos == 0:
		return 0.0, 0.5
	best_f1, best_t = 0.0, 0.5
	for t in np.unique(p)[::-1]:
		pred = p >= t
		tp = int(((pred == 1) & (y == 1)).sum())
		fp = int(((pred == 1) & (y == 0)).sum())
		precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
		recall = tp / total_pos
		f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0
		if f1 > best_f1:
			best_f1, best_t = float(f1), float(t)
	return best_f1, best_t


def calibrate_thresholds(
	probs: np.ndarray, labels: np.ndarray, target_precision: float = TARGET_PRECISION
) -> list[float]:
	"""每标签：满足 precision ≥ target 的最小阈值（recall 最大化）；不可达回退 best-F1 阈值。"""
	thresholds: list[float] = []
	for j in range(probs.shape[1]):
		y, p = labels[:, j], probs[:, j]
		chosen: float | None = None
		for t in np.unique(p)[::-1]:  # 降序扫全部阈值，保留最后一个（=最小）满足者
			pred = p >= t
			tp = int(((pred == 1) & (y == 1)).sum())
			fp = int(((pred == 1) & (y == 0)).sum())
			if (tp + fp) > 0 and tp > 0 and tp / (tp + fp) >= target_precision:
				chosen = float(t)
		if chosen is None:
			_, chosen = best_f1_threshold(y, p)
			chosen = max(chosen, 0.5)
		thresholds.append(chosen)
	return thresholds


# ---------- 切分与训练 ----------

def group_split(groups: np.ndarray, seed: int = 0, frac: tuple[float, float, float] = (0.8, 0.1, 0.1)):
	"""按组（bookId）切 train/val/test；组数不足 3 时退化（全部进 train）。"""
	uniq = np.unique(groups)
	rng = np.random.default_rng(seed)
	rng.shuffle(uniq)
	n = len(uniq)
	n_val = max(1, int(round(n * frac[1]))) if n >= 3 else 0
	n_test = max(1, int(round(n * frac[2]))) if n >= 3 else 0
	if n_val + n_test >= n and n >= 3:
		n_val, n_test = 1, 1
	val_groups = set(uniq[:n_val].tolist())
	test_groups = set(uniq[n_val : n_val + n_test].tolist())
	train_mask = np.array([g not in val_groups and g not in test_groups for g in groups])
	val_mask = np.array([g in val_groups for g in groups])
	test_mask = np.array([g in test_groups for g in groups])
	return train_mask, val_mask, test_mask


def train_head(
	embeddings: np.ndarray,
	features: np.ndarray,
	labels: np.ndarray,
	groups: np.ndarray,
	lr: float = 5e-2,
	epochs: int = 800,
	patience: int = 100,
	l2: float = DEFAULT_L2,
	max_pos_weight: float = 20.0,
	seed: int = 0,
) -> tuple[Weights, dict]:
	"""训练共享 logistic 头，返回 (weights, metrics)。"""
	import torch

	assert embeddings.shape[0] == features.shape[0] == labels.shape[0] == groups.shape[0]
	train_mask, val_mask, test_mask = group_split(groups, seed=seed)
	if val_mask.sum() == 0:  # 组太少：留 10% 段做 val（仅退化场景）
		rng = np.random.default_rng(seed)
		idx = rng.permutation(len(labels))
		val_mask = np.zeros(len(labels), dtype=bool)
		val_mask[idx[: max(1, len(idx) // 10)]] = True
		train_mask = ~val_mask
		test_mask = np.zeros(len(labels), dtype=bool)

	mu = features[train_mask].mean(axis=0)
	sd = features[train_mask].std(axis=0) + 1e-9
	features_n = (features - mu) / sd

	dim = embeddings.shape[1] + features.shape[1]
	torch.manual_seed(seed)
	W = torch.zeros(len(LABEL_KEYS), dim, requires_grad=True)
	b = torch.zeros(len(LABEL_KEYS), requires_grad=True)
	pos = (labels[train_mask] == 1).sum(axis=0)
	neg = (labels[train_mask] == 0).sum(axis=0)
	pw = np.clip((neg + 1.0) / (pos + 1.0), 1.0, max_pos_weight)
	loss_fn = torch.nn.BCEWithLogitsLoss(pos_weight=torch.tensor(pw, dtype=torch.float32))

	def to_z(mask: np.ndarray) -> torch.Tensor:
		emb = torch.tensor(embeddings[mask], dtype=torch.float32)
		feat = torch.tensor(features_n[mask], dtype=torch.float32)
		return torch.cat([emb, feat], dim=1)

	z_train, y_train = to_z(train_mask), torch.tensor(labels[train_mask], dtype=torch.float32)
	z_val, y_val_np = to_z(val_mask), labels[val_mask]
	optimizer = torch.optim.Adam([W, b], lr=lr, weight_decay=l2)

	best_auc, best_state, best_epoch, stale = -1.0, None, -1, 0
	for epoch in range(epochs):
		optimizer.zero_grad()
		loss = loss_fn(z_train @ W.T + b, y_train)
		loss.backward()
		optimizer.step()
		with torch.no_grad():
			val_probs = torch.sigmoid(z_val @ W.T + b).numpy()
		macro = float(np.mean([roc_auc(y_val_np[:, j], val_probs[:, j]) for j in range(labels.shape[1])]))
		if macro > best_auc + 1e-5:
			best_auc, best_epoch, stale = macro, epoch, 0
			best_state = (W.detach().clone(), b.detach().clone())
		else:
			stale += 1
			if stale >= patience:
				break
	if best_state is not None:
		W = best_state[0]
		b = best_state[1]

	with torch.no_grad():
		probs_all = torch.sigmoid(to_z(np.ones(len(labels), dtype=bool)) @ W.T + b).numpy()
	thresholds = calibrate_thresholds(probs_all[val_mask], labels[val_mask])

	metrics: dict = {"bestEpoch": best_epoch, "valMacroAuc": best_auc, "perLabel": {}}
	for j, key in enumerate(LABEL_KEYS):
		m = test_mask if test_mask.sum() > 0 else val_mask
		metrics["perLabel"][key] = {
			"rocAuc": roc_auc(labels[m, j], probs_all[m, j]),
			"prAuc": pr_auc(labels[m, j], probs_all[m, j]),
			"f1@tau": best_f1_threshold(labels[m, j], probs_all[m, j])[0],
			"tau": thresholds[j],
			"posTrain": int(pos[j]),
		}
	weights = Weights(
		labels_version=LABELS_VERSION,
		labels=list(LABEL_KEYS),
		feature_keys=list(FEATURE_KEYS),
		embedding_dim=int(embeddings.shape[1]),
		W=W.numpy().tolist(),
		b=b.numpy().tolist(),
		feature_norm={"mu": mu.tolist(), "sd": sd.tolist()},
		thresholds=thresholds,
		train_data={
			"trainedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
			"nTrain": int(train_mask.sum()),
			"nVal": int(val_mask.sum()),
			"nTest": int(test_mask.sum()),
			"seed": seed,
			"l2": l2,
			"posWeight": pw.tolist(),
		},
	)
	return weights, metrics


# ---------- 数据装配与 CLI ----------

def assemble_training_data(
	windows_path: Path, labels_path: Path, embeddings_path: Path
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
	"""windows.jsonl + labels.jsonl + embeddings.npz → (嵌入, 特征, 标签, 分组)。"""
	with open(labels_path, encoding="utf-8") as fh:
		labels_by_id = {rec["windowId"]: rec for rec in (json.loads(line) for line in fh if line.strip())}
	embeddings = np.load(embeddings_path)
	emb_rows, feat_rows, label_rows, groups = [], [], [], []
	with open(windows_path, encoding="utf-8") as fh:
		for line in fh:
			if not line.strip():
				continue
			rec = json.loads(line)
			wid = rec["windowId"]
			if wid not in labels_by_id or wid not in embeddings:
				continue
			n = len(rec["texts"])
			emb = embeddings[wid]
			if emb.shape[0] != n:
				continue
			for i in range(n):
				unit_labels = labels_by_id[wid]["labels"][i]
				emb_rows.append(emb[i])
				feat_rows.append(rec["features"][i])
				label_rows.append([int(unit_labels.get(k, 0)) for k in LABEL_KEYS])
				groups.append(rec["bookId"])
	return (
		np.array(emb_rows, dtype=np.float64),
		np.array(feat_rows, dtype=np.float64),
		np.array(label_rows, dtype=np.int64),
		np.array(groups),
	)


def make_synthetic(n_windows: int = 400, dim: int = 512, seed: int = 0):
	"""合成可分数据（框架冒烟/测试）：标签 j 正例当嵌入第 j 维 > 阈值（带噪声）。"""
	rng = np.random.default_rng(seed)
	emb = rng.normal(size=(n_windows * 8, dim))
	signal = rng.normal(size=(n_windows * 8, len(LABEL_KEYS))) * 0.1
	labels = (emb[:, : len(LABEL_KEYS)] + signal > 0.8).astype(np.int64)
	features = rng.normal(size=(n_windows * 8, len(FEATURE_KEYS)))
	groups = np.array([f"synth-{i % 5}" for i in range(n_windows * 8)])
	return emb, features, labels, groups


def main(argv: list[str] | None = None) -> int:
	parser = argparse.ArgumentParser(description="训练 prose-gate 头")
	parser.add_argument("--windows", type=Path, default=Path("artifacts/windows.jsonl"))
	parser.add_argument("--labels", type=Path, default=Path("artifacts/labels.jsonl"))
	parser.add_argument("--embeddings", type=Path, default=Path("artifacts/embeddings.npz"))
	parser.add_argument("--out", type=Path, default=Path("artifacts/prose-gate-weights.v1.json"))
	parser.add_argument("--synthetic", action="store_true", help="合成数据端到端冒烟（不读真实数据）")
	parser.add_argument("--seed", type=int, default=0)
	args = parser.parse_args(argv)

	if args.synthetic:
		emb, feat, labels, groups = make_synthetic(seed=args.seed)
	else:
		emb, feat, labels, groups = assemble_training_data(
			args.windows, args.labels, args.embeddings
		)
	print(f"训练样本 {len(labels)} 段，正例分布 {dict(zip(LABEL_KEYS, labels.sum(axis=0).tolist()))}")
	weights, metrics = train_head(emb, feat, labels, groups, seed=args.seed)
	save_weights(weights, args.out)
	print(json.dumps(metrics, ensure_ascii=False, indent=1))
	print(f"weights → {args.out}")
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
