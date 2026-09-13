"""训练器：冻结嵌入 + 8 维特征 → 缺陷 7 标签 logistic 头 + 情绪线有序头（torch，PRD F4）。

- 缺陷头损失：BCEWithLogits + 每标签 pos_weight(cap 20)；
- 情绪头（v2）：CORAL 有序回归——共享打分 score=w·z，P(强度≥k)=σ(score−b_k)，
  三档累积 BCE，行级缺失（-1）跳过；保存时 b 投影为升序（单调契约）；
- 损失合计：缺陷 + emotion_weight × 情绪；L2(1e-2)；
- 切分：按 bookId 分组 8:1:1（同书不跨集，防泄漏）；
- 早停：val 缺陷宏 ROC-AUC + 情绪累积 AUC（联合判据，防缺陷头先收敛截断情绪头）；
- 阈值校准：precision ≥ 0.9 反推 τ，不可达回退 best-F1；
- 产物：prose-gate-weights.v2.json（weights.py 契约 schema=2）。
torch 延迟导入：无网络环境可跑除本模块外的全部测试。
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np

from .embed import MODEL_TIERS, tier_spec
from .features import FEATURE_KEYS
from .labels import EMOTION_MAX, LABELS_VERSION, LABEL_KEYS
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

def _expect_emotion(score: np.ndarray, biases: np.ndarray) -> np.ndarray:
	"""有序头期望强度 E = Σ_k σ(score − b_k)。"""
	cum = 1.0 / (1.0 + np.exp(-(score[:, None] - biases[None, :])))
	return cum.sum(axis=1)


def _recalibrate_emotion_biases(score: np.ndarray, y: np.ndarray, b0: np.ndarray) -> np.ndarray:
	"""冻结 score，仿射重校准（scale+shift 网格 + 升序投影）最小化期望强度 MAE。"""
	if (y >= 0).sum() < 20 or len(b0) != 3:
		return np.asarray(b0, dtype=np.float64)
	s, yv = score[y >= 0], y[y >= 0]
	b0 = np.asarray(b0, dtype=np.float64)
	best_b, best_mae = b0, float(np.mean(np.abs(_expect_emotion(s, b0) - yv)))
	for scale in np.linspace(0.3, 3.0, 28):
		for shift in np.linspace(-1.5, 1.5, 25):
			cand = np.sort(b0 * scale + shift)
			mae = float(np.mean(np.abs(_expect_emotion(s, cand) - yv)))
			if mae < best_mae:
				best_b, best_mae = cand, mae
	return best_b


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
	emotion: np.ndarray | None = None,
	lr: float = 5e-2,
	epochs: int = 800,
	patience: int = 100,
	l2: float = DEFAULT_L2,
	max_pos_weight: float = 20.0,
	emotion_weight: float = 1.0,
	seed: int = 0,
) -> tuple[Weights, dict]:
	"""联合训练缺陷 7 标签头 + 情绪有序头（emotion 提供时），返回 (weights, metrics)。
	emotion: (n,) 0-3 档位，-1 表示该段缺失（v1 遗留/未标），从情绪损失中剔除。"""
	import torch

	assert embeddings.shape[0] == features.shape[0] == labels.shape[0] == groups.shape[0]
	if emotion is not None:
		assert emotion.shape[0] == labels.shape[0]
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
	params: list = [W, b]
	has_emotion = emotion is not None and bool((np.asarray(emotion) >= 0).any())
	em_np = np.asarray(emotion) if has_emotion else None
	if has_emotion:
		ew = torch.zeros(dim, requires_grad=True)
		eb = torch.tensor([0.0, 1.0, 2.0], requires_grad=True)  # 升序初值：P(≥1)≥P(≥2)≥P(≥3)
		params += [ew, eb]
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
	cum_train = valid_train = None
	em_val: np.ndarray | None = None  # val 子集情绪（-1 缺失），早停与指标共用
	if has_emotion:
		em_all = torch.tensor(em_np, dtype=torch.long)
		cum_all_t = (em_all.unsqueeze(1) > torch.arange(1, EMOTION_MAX + 1).unsqueeze(0)).float()
		valid_all_t = (em_all >= 0).float()
		cum_train = cum_all_t[torch.tensor(train_mask)]
		valid_train = valid_all_t[torch.tensor(train_mask)]
		em_val = em_np[val_mask]
	optimizer = torch.optim.Adam(
		(
			[
				{"params": [W, b, ew], "weight_decay": l2},
				{"params": [eb], "weight_decay": 0.0},  # 有序阈值免 decay：拉向 0 会破坏校准
			]
			if has_emotion
			else [{"params": params, "weight_decay": l2}]
		),
		lr=lr,
	)

	def emo_auc_val(cum_probs_np: np.ndarray) -> float:
		"""val 上三档累积 AUC 均值（无有效行返回 0）。"""
		if em_val is None:
			return 0.0
		valid = em_val >= 0
		if not valid.any():
			return 0.0
		return float(
			np.mean(
				[
					roc_auc((em_val[valid] > k).astype(int), cum_probs_np[valid, k])
					for k in range(EMOTION_MAX)
				]
			)
		)

	best_criterion, best_auc, best_state, best_epoch, stale = -1.0, -1.0, None, -1, 0
	for epoch in range(epochs):
		optimizer.zero_grad()
		loss = loss_fn(z_train @ W.T + b, y_train)
		if has_emotion:
			cum_logits = (z_train @ ew).unsqueeze(1) - eb.unsqueeze(0)
			raw = torch.nn.functional.binary_cross_entropy_with_logits(
				cum_logits, cum_train, reduction="none"
			)
			emo_loss = (raw * valid_train.unsqueeze(1)).sum() / (valid_train.sum() * EMOTION_MAX + 1e-9)
			loss = loss + emotion_weight * emo_loss
		loss.backward()
		optimizer.step()
		with torch.no_grad():
			val_probs = torch.sigmoid(z_val @ W.T + b).numpy()
		macro = float(np.mean([roc_auc(y_val_np[:, j], val_probs[:, j]) for j in range(labels.shape[1])]))
		criterion = macro
		if has_emotion:
			with torch.no_grad():
				cum_val_np = torch.sigmoid((z_val @ ew).unsqueeze(1) - eb.unsqueeze(0)).numpy()
			criterion = macro + emo_auc_val(cum_val_np)
		if criterion > best_criterion + 1e-5:
			best_criterion, best_auc, best_epoch, stale = criterion, macro, epoch, 0
			best_state = tuple(p.detach().clone() for p in params)
		else:
			stale += 1
			if stale >= patience:
				break
	if best_state is not None:
		W, b = best_state[0], best_state[1]
		if has_emotion:
			ew, eb = best_state[2], best_state[3]

	if has_emotion:
		# 阈值事后仿射重校准：CORAL 联合训练的 biases 受类不平衡牵引（稀有档被顶高），
		# 冻结 score 后 2 参数（scale+shift）网格搜索最小化训练集期望 MAE——无过拟合空间，
		# 直接对齐下游消费量（期望强度→极差→派生平直，整体偏移天然被差分抵消）。
		with torch.no_grad():
			score_train = (z_train @ ew).numpy()
		eb = torch.tensor(
			_recalibrate_emotion_biases(score_train, em_np[train_mask], eb.numpy()),
			dtype=torch.float32,
		)

	all_mask = np.ones(len(labels), dtype=bool)
	with torch.no_grad():
		probs_all = torch.sigmoid(to_z(all_mask) @ W.T + b).numpy()
		cum_all = (
			torch.sigmoid((to_z(all_mask) @ ew).unsqueeze(1) - eb.unsqueeze(0)).numpy()
			if has_emotion
			else None
		)
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
	emotion_w_out: list[float] = []
	emotion_b_out: list[float] = []
	if has_emotion:
		em_np = np.asarray(emotion)
		m = test_mask if test_mask.sum() > 0 else val_mask
		vm = m & (em_np >= 0)
		expect = cum_all.sum(axis=1)
		metrics["emotion"] = {
			"mae": float(np.mean(np.abs(expect[vm] - em_np[vm]))) if vm.any() else None,
			"cumAuc": [
				roc_auc((em_np[vm] > k).astype(int), cum_all[vm, k]) for k in range(EMOTION_MAX)
			] if vm.any() else [None] * EMOTION_MAX,
			"nTrain": int((train_mask & (em_np >= 0)).sum()),
		}
		emotion_w_out = ew.numpy().tolist()
		emotion_b_out = sorted(eb.numpy().tolist())  # 投影升序，保 P(≥k) 单调契约
	weights = Weights(
		labels_version=LABELS_VERSION,
		labels=list(LABEL_KEYS),
		feature_keys=list(FEATURE_KEYS),
		embedding_dim=int(embeddings.shape[1]),
		W=W.numpy().tolist(),
		b=b.numpy().tolist(),
		feature_norm={"mu": mu.tolist(), "sd": sd.tolist()},
		thresholds=thresholds,
		emotion_w=emotion_w_out,
		emotion_b=emotion_b_out,
		train_data={
			"trainedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
			"nTrain": int(train_mask.sum()),
			"nVal": int(val_mask.sum()),
			"nTest": int(test_mask.sum()),
			"seed": seed,
			"l2": l2,
			"posWeight": pw.tolist(),
			"emotionWeight": emotion_weight if has_emotion else None,
		},
	)
	return weights, metrics


# ---------- 数据装配与 CLI ----------

def assemble_training_data(
	windows_path: Path, labels_path: Path, embeddings_path: Path
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
	"""windows.jsonl + labels.jsonl + embeddings.npz → (嵌入, 特征, 标签, 情绪线, 分组)。
	情绪线来自标注记录的 emotion 数组（v2）；缺失记 -1（训练时行级跳过）。"""
	with open(labels_path, encoding="utf-8") as fh:
		labels_by_id = {rec["windowId"]: rec for rec in (json.loads(line) for line in fh if line.strip())}
	embeddings = np.load(embeddings_path)
	emb_rows, feat_rows, label_rows, emotion_rows, groups = [], [], [], [], []
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
			rec_emotion = labels_by_id[wid].get("emotion") or []
			for i in range(n):
				unit_labels = labels_by_id[wid]["labels"][i]
				emb_rows.append(emb[i])
				feat_rows.append(rec["features"][i])
				label_rows.append([int(unit_labels.get(k, 0)) for k in LABEL_KEYS])
				emotion_rows.append(int(rec_emotion[i]) if i < len(rec_emotion) else -1)
				groups.append(rec["bookId"])
	return (
		np.array(emb_rows, dtype=np.float64),
		np.array(feat_rows, dtype=np.float64),
		np.array(label_rows, dtype=np.int64),
		np.array(emotion_rows, dtype=np.int64),
		np.array(groups),
	)


def make_synthetic(n_windows: int = 400, dim: int = 512, seed: int = 0):
	"""合成可分数据（框架冒烟/测试）：标签 j 正例当嵌入第 j 维 > 阈值（带噪声）；
	情绪线由第 8 维强度信号生成 0-3 序数（含噪声）。"""
	rng = np.random.default_rng(seed)
	emb = rng.normal(size=(n_windows * 8, dim))
	signal = rng.normal(size=(n_windows * 8, len(LABEL_KEYS))) * 0.1
	labels = (emb[:, : len(LABEL_KEYS)] + signal > 0.8).astype(np.int64)
	emotion = np.clip(
		np.rint(1.2 + 1.1 * emb[:, len(LABEL_KEYS)] + rng.normal(size=n_windows * 8) * 0.3),
		0,
		EMOTION_MAX,
	).astype(np.int64)
	features = rng.normal(size=(n_windows * 8, len(FEATURE_KEYS)))
	groups = np.array([f"synth-{i % 5}" for i in range(n_windows * 8)])
	return emb, features, labels, emotion, groups


def main(argv: list[str] | None = None) -> int:
	parser = argparse.ArgumentParser(description="训练 prose-gate 头（缺陷 7 标签 + 情绪有序头）")
	parser.add_argument("--windows", type=Path, default=Path("artifacts/windows.jsonl"))
	parser.add_argument("--labels", type=Path, default=Path("artifacts/labels.jsonl"))
	parser.add_argument("--embeddings", type=Path, default=Path("artifacts/embeddings.npz"))
	parser.add_argument("--out", type=Path, default=Path("artifacts/prose-gate-weights.v2.json"))
	parser.add_argument("--synthetic", action="store_true", help="合成数据端到端冒烟（不读真实数据）")
	parser.add_argument(
		"--tier",
		default="small",
		choices=sorted(MODEL_TIERS),
		help="编码器档位：写入 weights.encoder 并校验嵌入维度（large 预留）",
	)
	parser.add_argument("--seed", type=int, default=0)
	args = parser.parse_args(argv)

	spec = tier_spec(args.tier)
	if args.synthetic:
		emb, feat, labels, emotion, groups = make_synthetic(seed=args.seed, dim=spec["dim"])
	else:
		emb, feat, labels, emotion, groups = assemble_training_data(
			args.windows, args.labels, args.embeddings
		)
	if emb.shape[1] != spec["dim"]:
		raise SystemExit(
			f"嵌入维度 {emb.shape[1]} 与档位 {args.tier}（dim={spec['dim']}）不符——检查 embed --tier"
		)
	print(f"训练样本 {len(labels)} 段，正例分布 {dict(zip(LABEL_KEYS, labels.sum(axis=0).tolist()))}")
	print(f"情绪线有效段 {(emotion >= 0).sum()}（0-3 分布 {np.bincount(np.clip(emotion, 0, EMOTION_MAX)).tolist()}）")
	weights, metrics = train_head(emb, feat, labels, groups, emotion=emotion, seed=args.seed)
	weights.encoder = {"tier": args.tier, **spec}
	save_weights(weights, args.out)
	print(json.dumps(metrics, ensure_ascii=False, indent=1))
	print(f"weights → {args.out}（tier={args.tier}）")
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
