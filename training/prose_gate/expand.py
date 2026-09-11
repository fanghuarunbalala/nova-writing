"""AI 扩写生成：leaf unit（五要素大纲）→ 一句一段正文（配对标注的 AI 侧）。

设计要点：prompt 只给大纲与形式约束（一句一段、目标行数、本书节奏），**刻意不给任何
质量/反套话指令**——扩写要代表 harness 生成的真实缺陷分布，先写出典型的"AI 味"才是
合格的训练负样本来源（等价于 CHI2025 LAMP 的 Step 3，但不加"avoid clichés"提示）。
LLM 通道复用 annotate.py 的 OpenAI 兼容调用与 env 约定；call 可注入（测试无网络）。
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from .annotate import STYLE_ANCHOR, call_openai_compat, resolve_model
from .features import paragraph_features
from .windowing import build_windows, re_split_paragraphs

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_UNITS = REPO_ROOT / "evals" / "fixtures" / "books" / "ywjs" / "leaf-units.json"

EXPAND_SYSTEM = "你是中文网文作者，按给定大纲写正文。只输出正文，不加任何解释。"

FORM_PRESETS = {
	# 一句一段范式（ywjs 类）
	"sentence": "每行一句、一句一段",
	# 传统长段范式（武道宗师类）
	"paragraph": "每行一个自然段，一段可含多句",
}


def build_expand_prompt(
	unit: dict, style_anchor: str, target_lines: int, form_line: str = FORM_PRESETS["sentence"]
) -> str:
	elements = unit.get("elements", {})
	element_lines = "\n".join(f"- {k}：{v}" for k, v in elements.items())
	return f"""按下面的场景大纲写一章网文正文。

【场景大纲】（id：{unit.get("id")}，标题：{unit.get("title")}）
{element_lines}

【本书文风基准】
{style_anchor}

【形式要求】
- {form_line}，共约 {target_lines} 行
- 直接从正文开始，不要章节号和小标题
- 覆盖大纲全部五要素"""


def expand_unit(
	unit: dict,
	target_lines: int,
	model: str | None = None,
	call=call_openai_compat,
	max_attempts: int = 3,
	style_anchor: str = STYLE_ANCHOR,
	form: str = "sentence",
) -> tuple[str, str]:
	"""扩写一个 leaf unit，返回 (正文文本, 实际使用的模型)。

	推理型模型可能把 max_tokens 预算耗在推理段导致可见内容为空——给足 8192 并对
	空返回自动重试；连续空返回则显式报错（不静默产出空窗口）。
	"""
	resolved = resolve_model(model)
	prompt = build_expand_prompt(unit, style_anchor, target_lines, FORM_PRESETS[form])

	def too_short(text: str) -> bool:
		lines = [line for line in text.splitlines() if line.strip()]
		return target_lines >= 20 and len(lines) < target_lines * 0.6

	best = ""
	for _attempt in range(max_attempts):
		reply = call(EXPAND_SYSTEM, prompt, resolved, max_tokens=8192)
		text = reply.strip()
		if text and not too_short(text):
			return text, resolved
		if len(text) > len(best):
			best = text  # 空返回/过短时保留最长者，重试
		time.sleep(2)
	if best:
		return best, resolved  # 屡次过短也接受最长版本（配对按索引截断，不致错位）
	raise RuntimeError(f"{unit['id']} 扩写连续 {max_attempts} 次返回空文本（模型 {resolved}）")


def chapter_line_counts(windows_path: Path) -> dict[int, int]:
	"""从原文 windows.jsonl 统计各章**有效段数**（line_index 含空行，按去重计数；
	扩写目标行数基准，窗口数尽量对齐）。"""
	lines: dict[int, set[int]] = {}
	with open(windows_path, encoding="utf-8") as fh:
		for line in fh:
			if not line.strip():
				continue
			rec = json.loads(line)
			no = int(rec["chapterNo"])
			lines.setdefault(no, set()).update(rec["lineIndexes"])
	return {no: len(indexes) for no, indexes in lines.items()}


def ai_windows_from_text(
	text: str, chapter_no: int, book_id: str = "ywjs-ai", source: str = "ai-expanded"
) -> list[dict]:
	"""AI 生成文本 → 窗口记录（source：ai-expanded=配对仿写 / ai-generated=独立注入）。"""
	units = re_split_paragraphs(text)
	return [
		{
			"windowId": w.window_id,
			"bookId": book_id,
			"chapterNo": w.chapter_no,
			"source": source,
			"lineIndexes": [u.line_index for u in w.units],
			"texts": list(w.texts),
			"features": paragraph_features(w.texts),
		}
		for w in build_windows(book_id, chapter_no, units)
	]


def main(argv: list[str] | None = None) -> int:
	parser = argparse.ArgumentParser(description="leaf units → AI 扩写 → 窗口 jsonl")
	parser.add_argument("--units", type=Path, default=DEFAULT_UNITS)
	parser.add_argument("--windows", type=Path, default=Path("artifacts/windows.jsonl"))
	parser.add_argument("--out-expansions", type=Path, default=Path("artifacts/expansions.jsonl"))
	parser.add_argument("--out-windows", type=Path, default=Path("artifacts/ai-windows.jsonl"))
	parser.add_argument("--chapters", default=None, help="逗号分隔章号，缺省全部")
	parser.add_argument("--model", default=None)
	parser.add_argument("--book-id", default="ywjs-ai", help="AI 侧 bookId（导出/配对用）")
	parser.add_argument("--style-file", type=Path, default=None, help="本书文风基准文本文件（缺省 ywjs 风格锚）")
	parser.add_argument("--form", choices=sorted(FORM_PRESETS), default="sentence")
	args = parser.parse_args(argv)

	all_units = json.loads(args.units.read_text(encoding="utf-8"))["units"]
	chapters = {int(c) for c in args.chapters.split(",")} if args.chapters else None
	selected = [u for u in all_units if chapters is None or int(u["chapterNo"]) in chapters]
	if not selected:
		raise SystemExit("选中的章号为空")
	line_counts = chapter_line_counts(args.windows)
	style_anchor = (
		args.style_file.read_text(encoding="utf-8").strip() if args.style_file else STYLE_ANCHOR
	)

	expansion_records: list[dict] = []
	window_records: list[dict] = []
	for unit in selected:
		chapter_no = int(unit["chapterNo"])
		target = line_counts.get(chapter_no, 48)
		text, model = expand_unit(
			unit, target, model=args.model, style_anchor=style_anchor, form=args.form
		)
		expansion_records.append(
			{
				"unitId": unit["id"],
				"chapterNo": chapter_no,
				"title": unit.get("title"),
				"text": text,
				"targetLines": target,
				"meta": {"model": model, "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z")},
			}
		)
		window_records.extend(ai_windows_from_text(text, chapter_no, book_id=args.book_id))
		print(f"[{chapter_no}] {unit['id']} → {len(re_split_paragraphs(text))} 行（目标 {target}）")

	for path, records in ((args.out_expansions, expansion_records), (args.out_windows, window_records)):
		path.parent.mkdir(parents=True, exist_ok=True)
		with open(path, "w", encoding="utf-8") as fh:
			for rec in records:
				fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
	print(
		f"扩写 {len(expansion_records)} 章 → {args.out_expansions}；"
		f"AI 窗口 {len(window_records)} → {args.out_windows}"
	)
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
