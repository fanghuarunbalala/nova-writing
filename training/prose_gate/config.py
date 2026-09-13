"""工作台 LLM provider 配置（PRD 训练数据工作台 v2 F3）。

workbench-config.json（training/artifacts/，gitignored，本机明文——单人本地工具）：
{baseUrl, apiKey, model, judgeModel}。优先级：config > 环境变量（annotate.resolve_* 链）。
API Key 只写不回读（GET/PUT 掩码）；保存原子写，网页保存即时生效免重启（每次调用动态读）。
分工：窗口概要提炼/扩写 = 生成模型 model；⚡ 预标 = 标注模型 judgeModel。
"""

from __future__ import annotations

import json
import time
from pathlib import Path

from .annotate import call_openai_compat, resolve_base_url, resolve_model

CONFIG_NAME = "workbench-config.json"
FIELDS = ("baseUrl", "apiKey", "model", "judgeModel")


def config_path(artifacts_dir: str | Path) -> Path:
	return Path(artifacts_dir) / CONFIG_NAME


def load_config(artifacts_dir: str | Path) -> dict:
	"""读配置（缺文件/坏 JSON → 空 dict；只保留已知字段并去空白）。"""
	path = config_path(artifacts_dir)
	if not path.exists():
		return {}
	try:
		raw = json.loads(path.read_text(encoding="utf-8"))
	except json.JSONDecodeError:
		return {}
	if not isinstance(raw, dict):
		return {}
	return {k: str(raw.get(k, "")).strip() for k in FIELDS if str(raw.get(k, "")).strip()}


def save_config(artifacts_dir: str | Path, cfg: dict) -> dict:
	"""合并保存（空 apiKey = 保留旧值；未知字段丢弃），临时文件原子写。返回合并后的完整配置。"""
	merged = load_config(artifacts_dir)
	for key in ("baseUrl", "model", "judgeModel"):
		if key in cfg:
			value = str(cfg.get(key, "")).strip()
			if value:
				merged[key] = value
			else:
				merged.pop(key, None)
	api_key = str(cfg.get("apiKey", "")).strip()
	if api_key:
		merged["apiKey"] = api_key
	path = config_path(artifacts_dir)
	path.parent.mkdir(parents=True, exist_ok=True)
	tmp = path.with_suffix(".tmp")
	tmp.write_text(json.dumps(merged, ensure_ascii=False, indent=1), encoding="utf-8")
	tmp.replace(path)
	return merged


def masked(cfg: dict) -> dict:
	"""API 回显用：key 掩码 + hasKey 标记（前端区分「未配置」与「已配置未改动」）。"""
	key = cfg.get("apiKey", "")
	out = {k: cfg.get(k, "") for k in ("baseUrl", "model", "judgeModel")}
	out["apiKey"] = (key[:3] + "***" + key[-4:]) if len(key) > 8 else ("***" if key else "")
	out["hasKey"] = bool(key)
	return out


def model_for(cfg: dict, kind: str, override: str | None = None) -> str:
	"""用途 → 模型：gen=提炼/扩写（model），judge=预标（judgeModel）；config > env 链。"""
	if override:
		return override
	if kind == "judge" and cfg.get("judgeModel"):
		return cfg["judgeModel"]
	if kind == "gen" and cfg.get("model"):
		return cfg["model"]
	return resolve_model(None)


def make_call(cfg: dict):
	"""config 里 baseUrl+apiKey 齐备 → 绑定该通道；否则回退 env 通道（call_openai_compat）。"""
	if cfg.get("baseUrl") and cfg.get("apiKey"):
		base, key = cfg["baseUrl"], cfg["apiKey"]
		return lambda system, user, model, max_tokens=2048: call_openai_compat(
			system, user, model, max_tokens=max_tokens, base_url=base, api_key=key
		)
	return call_openai_compat


def test_connection(cfg: dict, call=None, model: str | None = None) -> dict:
	"""一次小调用验证通道，返回 {model, latencyMs, reply}（异常向上抛由路由转 4xx）。"""
	resolved = model_for(cfg, "gen", model)
	caller = call or make_call(cfg)
	start = time.perf_counter()
	reply = caller(
		"你是连接测试器。只回复：OK", "请回复 OK", resolved, max_tokens=16
	)
	return {
		"model": resolved,
		"baseUrl": cfg.get("baseUrl") or resolve_base_url(),
		"latencyMs": int((time.perf_counter() - start) * 1000),
		"reply": reply.strip()[:40],
	}
