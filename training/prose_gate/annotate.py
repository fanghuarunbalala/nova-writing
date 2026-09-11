"""LLM 标注器：窗口 → 逐段×8 标签 0/1 + 证据摘抄（PRD F3，标注 prompt v1）。

调用约定与 evals/src/judge.ts 同源（OpenAI 兼容 /chat/completions）：
- key：NOVEL_EVAL_API_KEY ?? NOVEL_PROVIDER_API_KEY ?? ANTHROPIC_AUTH_TOKEN
- base：NOVEL_EVAL_BASE_URL ?? https://api.deepseek.com/v1
- 模型：--model ?? NOVEL_EVAL_JUDGE_MODEL ?? NOVEL_EVAL_MODEL ?? deepseek-v4-flash
硬校验：label=1 必须附 evidence 且为该段原文子串，否则该判分作废记入 errors。
本模块只负责标注；试标/扩量由 CLI 批量跑 windows.jsonl → labels.jsonl。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Protocol

from .labels import LABEL_KEYS, PROSE_GATE_LABELS
from .windowing import Window

STYLE_ANCHOR = (
	"短句成段、一句一段、段间留白；动词驱动白描、少形容词堆叠；"
	"对话极简，答话常反着说或只给半句；天气与灯火等物象承载情绪；数词精确制造可信度。"
)

_ANNOTATION_SYSTEM = "你是资深中文网文编辑，为「文风质量判官」项目做段落缺陷标注。只输出 JSON。"


def build_annotation_prompt(window: Window, style_anchor: str = STYLE_ANCHOR) -> str:
	"""标注 prompt v1：风格锚定 + 8 标签累加标准/边界 + 其他字段 + 输出契约。由 labels.py 生成。"""
	labels_block = "\n".join(
		f"{i} {d.key} {d.label}：{d.rubric} 边界：{d.boundary}"
		for i, d in enumerate(PROSE_GATE_LABELS, start=1)
	)
	window_block = "\n".join(
		f"[{i}] {u.text}" for i, u in enumerate(window.units, start=1)
	)
	labels_json = json.dumps({k: 0 for k in LABEL_KEYS}, ensure_ascii=False)
	return f"""{_ANNOTATION_SYSTEM.split("。")[0]}。下面是一个窗口：同一章内连续 {len(window.units)} 段（本书为一段一句范式），每段带编号。请逐段、逐缺陷类别独立判定 0/1 并给证据。

【本书文风基准——符合以下特征的写法是好文风，绝不可判为缺陷】
{style_anchor}

【八类缺陷】
{labels_block}

【其他】八类之外发现明显缺陷，写入 other 数组自由描述（仅用于扩充清单，不参与判分）。

【硬性规则】
- 判 1 必须填 evidence：逐字摘抄该段原文子串（程序校验，对不上该判分作废）
- 不确定一律判 0；只输出 JSON，无其他文字

【输出格式】
{{"paragraphs":[{{"index":1,"labels":{labels_json},"evidence":{{}}}}],"other":[]}}
（evidence 仅对应 label=1 的项填写，如 {{"clicheExpression":"原文摘抄"}}）

【窗口文本】
{window_block}"""


class LLMCaller(Protocol):
	"""可注入的调用函数（测试用假实现替换，避免网络）。"""

	def __call__(self, system: str, user: str, model: str) -> str: ...


@dataclass
class AnnotationResult:
	"""标注结果：labels 为逐段 {key: 0/1}；证据校验失败的判分已归零并记 errors。"""

	labels: list[dict[str, int]]
	evidence: list[dict[str, str]] = field(default_factory=list)
	others: list[str] = field(default_factory=list)
	errors: list[str] = field(default_factory=list)

	def to_record(self, window: Window, model: str, prompt: str) -> dict:
		return {
			"windowId": window.window_id,
			"bookId": window.book_id,
			"chapterNo": window.chapter_no,
			"labels": self.labels,
			"evidence": self.evidence,
			"other": self.others,
			"errors": self.errors,
			"meta": {
				"annotator": "llm",
				"judgeModel": model,
				"labelsVersion": "v1",
				"promptSha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
				"annotatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
			},
		}


def parse_annotation_reply(reply: str, window: Window) -> AnnotationResult:
	"""解析标注 JSON 并做证据子串硬校验：label=1 的 evidence 必须是该段原文子串。"""
	n = len(window.units)
	result = AnnotationResult(labels=[], evidence=[])
	for _ in range(n):
		result.labels.append({k: 0 for k in LABEL_KEYS})
		result.evidence.append({})

	match = re.search(r"\{[\s\S]*\}", reply)
	if match is None:
		result.errors.append("judge 输出非 JSON")
		return result
	try:
		parsed = json.loads(match.group(0))
	except json.JSONDecodeError as exc:
		result.errors.append(f"JSON 解析失败：{exc}")
		return result

	for item in parsed.get("paragraphs", []):
		try:
			idx = int(item["index"]) - 1
		except (KeyError, TypeError, ValueError):
			result.errors.append(f"非法 index：{item!r}")
			continue
		if not 0 <= idx < n:
			result.errors.append(f"index 越界：{idx + 1}")
			continue
		unit_text = window.units[idx].text
		labels_in = item.get("labels", {})
		evidence_in = item.get("evidence", {}) or {}
		for key in LABEL_KEYS:
			if labels_in.get(key) != 1:
				continue
			ev = evidence_in.get(key, "")
			ev = ev.strip() if isinstance(ev, str) else ""
			if ev == "" or ev not in unit_text:
				result.errors.append(
					f"段{idx + 1} {key} 证据校验失败（非原文子串），判分作废"
				)
				continue
			result.labels[idx][key] = 1
			result.evidence[idx][key] = ev
	others = parsed.get("other", [])
	if isinstance(others, list):
		result.others = [str(o) for o in others if str(o).strip() != ""]
	return result


def resolve_api_key() -> str:
	for env in ("NOVEL_EVAL_API_KEY", "NOVEL_PROVIDER_API_KEY", "ANTHROPIC_AUTH_TOKEN"):
		value = __import__("os").environ.get(env)
		if value:
			return value
	raise SystemExit("缺少 API key：设置 NOVEL_EVAL_API_KEY（或回退 NOVEL_PROVIDER_API_KEY / ANTHROPIC_AUTH_TOKEN）")


def resolve_base_url() -> str:
	import os

	return os.environ.get("NOVEL_EVAL_BASE_URL", "https://api.deepseek.com/v1")


def resolve_model(model: str | None = None) -> str:
	import os

	return model or os.environ.get("NOVEL_EVAL_JUDGE_MODEL") or os.environ.get(
		"NOVEL_EVAL_MODEL", "deepseek-v4-flash"
	)


def call_openai_compat(system: str, user: str, model: str, max_tokens: int = 2048) -> str:
	"""OpenAI 兼容 /chat/completions 调用（stdlib urllib，temperature 0，重试 1 次）。"""
	payload = json.dumps(
		{
			"model": model,
			"temperature": 0,
			"max_tokens": max_tokens,
			"messages": [
				{"role": "system", "content": system},
				{"role": "user", "content": user},
			],
		}
	).encode("utf-8")
	url = resolve_base_url().rstrip("/") + "/chat/completions"
	key = resolve_api_key()
	last_error: Exception | None = None
	for _attempt in range(2):
		try:
			req = urllib.request.Request(
				url,
				data=payload,
				headers={
					"Content-Type": "application/json",
					"Authorization": f"Bearer {key}",
				},
			)
			with urllib.request.urlopen(req, timeout=120) as resp:
				body = json.loads(resp.read().decode("utf-8"))
			return body["choices"][0]["message"]["content"]
		except (urllib.error.URLError, urllib.error.HTTPError, KeyError, json.JSONDecodeError) as exc:
			last_error = exc
			time.sleep(2)
	raise RuntimeError(f"标注 LLM 调用失败（重试后）：{last_error}")


def annotate_window(
	window: Window,
	model: str | None = None,
	call: LLMCaller = call_openai_compat,
	style_anchor: str = STYLE_ANCHOR,
) -> tuple[AnnotationResult, str, str]:
	"""标注一个窗口，返回 (结果, prompt, 实际使用的模型)。"""
	resolved = resolve_model(model)
	prompt = build_annotation_prompt(window, style_anchor)
	reply = call(_ANNOTATION_SYSTEM, prompt, resolved)
	return parse_annotation_reply(reply, window), prompt, resolved


def main(argv: list[str] | None = None) -> int:
	parser = argparse.ArgumentParser(description="批量标注 windows.jsonl → labels.jsonl")
	parser.add_argument("--windows", default="artifacts/windows.jsonl")
	parser.add_argument("--out", default="artifacts/labels.jsonl")
	parser.add_argument("--model", default=None)
	parser.add_argument("--limit", type=int, default=None)
	args = parser.parse_args(argv)

	windows: list[Window] = []
	with open(args.windows, encoding="utf-8") as fh:
		for line in fh:
			rec = json.loads(line)
			from .windowing import SentenceUnit

			windows.append(
				Window(
					window_id=rec["windowId"],
					book_id=rec["bookId"],
					chapter_no=rec["chapterNo"],
					units=tuple(
						SentenceUnit(line_index=li, text=t)
						for li, t in zip(rec["lineIndexes"], rec["texts"])
					),
				)
			)
	if args.limit is not None:
		windows = windows[: args.limit]

	out_path = Path(args.out)
	out_path.parent.mkdir(parents=True, exist_ok=True)
	with open(out_path, "w", encoding="utf-8") as fh:
		for i, window in enumerate(windows, start=1):
			result, prompt, model = annotate_window(window, model=args.model)
			fh.write(json.dumps(result.to_record(window, model, prompt), ensure_ascii=False) + "\n")
			fh.flush()
			flag = " ⚠" if result.errors else ""
			print(f"[{i}/{len(windows)}] {window.window_id} done{flag}")
	print(f"labels → {out_path}")
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
