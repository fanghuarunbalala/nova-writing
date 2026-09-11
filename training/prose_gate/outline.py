"""大纲提取：章节正文 → leaf unit 五要素（人物/地点/事件/转折/情绪）。

配对标注的"同一大纲"来源：从真实书原文提取大纲（LLM 单章一次调用），
产物与 evals leaf-units.json 同构，供 expand.py 消费。
LLM 通道复用 annotate.py 的 OpenAI 兼容调用与 env 约定；call 可注入（测试无网络）。
"""

from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path

from .annotate import call_openai_compat, resolve_model

OUTLINE_SYSTEM = "你是网文编辑，从章节正文提取场景大纲。只输出 JSON。"

ELEMENT_KEYS = ("人物", "地点", "事件", "转折", "情绪")
MAX_INPUT_CHARS = 6000


def build_outline_prompt(chapter_title: str, text: str) -> str:
	truncated = text if len(text) <= MAX_INPUT_CHARS else text[:MAX_INPUT_CHARS] + "…（截断）"
	return f"""从这章网文正文提取场景大纲。

【要求】
- 五要素各用一句话概括，人物带关键特征，转折写清"从什么到什么"
- 输出 JSON：{{"title": "四字内标题", "elements": {{"人物": "…", "地点": "…", "事件": "…", "转折": "…", "情绪": "…"}}}}
- 只输出 JSON，无其他文字

【章节】{chapter_title}

【正文】
{truncated}"""


def parse_outline_reply(reply: str) -> dict:
	"""解析 {"title", "elements":{五要素}}；缺项置空串（不静默丢章）。

	要素截断 ≤100 字：防 LLM 提取时把原文成句抄进大纲——扩写只见大纲，
	配对差异才能反映"执行差距"而非"记忆原文"（防泄漏护栏）。
	"""
	match = re.search(r"\{[\s\S]*\}", reply)
	if match is None:
		raise ValueError("大纲输出非 JSON")
	parsed = json.loads(match.group(0))
	elements = parsed.get("elements", {}) or {}
	return {
		"title": str(parsed.get("title", "")).strip()[:12],
		"elements": {key: str(elements.get(key, "")).strip()[:100] for key in ELEMENT_KEYS},
	}


def extract_outline(
	chapter_title: str, text: str, model: str | None = None, call=call_openai_compat
) -> tuple[dict, str]:
	"""提取一章大纲，返回 (unit 的 title/elements 部分, 实际使用的模型)。"""
	resolved = resolve_model(model)
	reply = call(OUTLINE_SYSTEM, build_outline_prompt(chapter_title, text), resolved, max_tokens=2048)
	return parse_outline_reply(reply), resolved


def load_chapters(book_json_path: Path) -> list[tuple[int, str, str]]:
	"""book.json → [(章号, 章标题, 章全文)]，按章序。"""
	book = json.loads(book_json_path.read_text(encoding="utf-8"))
	chapters: dict[int, dict] = {}
	for para in book["paragraphs"]:
		no = int(para["chapterNo"])
		if no not in chapters:
			chapters[no] = {"title": para.get("chapterTitle", ""), "texts": []}
		chapters[no]["texts"].append(para["text"])
	return [
		(no, chapters[no]["title"], "\n".join(chapters[no]["texts"]))
		for no in sorted(chapters)
	]


def main(argv: list[str] | None = None) -> int:
	from .dataset import DEFAULT_FIXTURES

	parser = argparse.ArgumentParser(description="真实书章节 → leaf units（五要素大纲）")
	parser.add_argument("--book", default="wudao", help="夹具别名")
	parser.add_argument("--fixtures-dir", type=Path, default=DEFAULT_FIXTURES)
	parser.add_argument("--chapters", required=True, help="逗号分隔章号")
	parser.add_argument("--out", type=Path, default=None, help="缺省 artifacts/<book>-units.json")
	parser.add_argument("--model", default=None)
	args = parser.parse_args(argv)

	book_path = args.fixtures_dir / args.book / "book.json"
	if not book_path.exists():
		raise SystemExit(f"夹具不存在：{book_path}")
	wanted = {int(c) for c in args.chapters.split(",")}
	chapters = [(no, t, x) for no, t, x in load_chapters(book_path) if no in wanted]
	if not chapters:
		raise SystemExit("选中的章号为空")

	units: list[dict] = []
	models: dict[str, int] = {}
	for no, title, text in chapters:
		outline, model = extract_outline(title, text, model=args.model)
		models[model] = models.get(model, 0) + 1
		units.append(
			{
				"id": f"{args.book}-su-leaf-{no:02d}",
				"title": outline["title"] or title,
				"chapterNo": no,
				"elements": outline["elements"],
			}
		)
		print(f"[{no}] {title} → {outline['title']}（{len(outline['elements'])} 要素, {model}）")

	out = args.out or Path(f"artifacts/{args.book}-units.json")
	out.parent.mkdir(parents=True, exist_ok=True)
	payload = {
		"schema": 1,
		"book": args.book,
		"note": f"outline-extracted {time.strftime('%Y-%m-%dT%H:%M:%S%z')} by {models}",
		"units": units,
	}
	out.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
	print(f"units → {out}（{len(units)} 单元）")
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
