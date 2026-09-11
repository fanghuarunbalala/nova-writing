"""数据装配：书库夹具 book.json → 章节文本 → 重切 → 组窗 → windows.jsonl（含 8 维特征）。

数据池（PRD F3）：A 好文风池 = 夹具真实正文（source="book"）；
B 生成物池 = agent ```novel 产出文本（source="generated"，generated_pool 接口）。
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .features import FEATURE_KEYS, paragraph_features
from .windowing import build_windows, re_split_paragraphs

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_FIXTURES = REPO_ROOT / "evals" / "fixtures" / "books"


def build_book_windows(
	book_json_path: Path, source: str = "book", size: int = 8, step: int = 4
) -> list[dict]:
	"""读 book.json → 按章聚合段落文本 → 重切 → 组窗 → 记录（含特征与溯源）。"""
	book = json.loads(book_json_path.read_text(encoding="utf-8"))
	book_id = book["alias"]
	chapters: dict[int, list[str]] = {}
	chapter_order: list[int] = []
	for para in book["paragraphs"]:
		no = int(para["chapterNo"])
		if no not in chapters:
			chapters[no] = []
			chapter_order.append(no)
		chapters[no].append(para["text"])

	records: list[dict] = []
	for no in chapter_order:
		chapter_text = "\n".join(chapters[no])
		units = re_split_paragraphs(chapter_text)
		for window in build_windows(book_id, no, units, size=size, step=step):
			texts = window.texts
			records.append(
				{
					"windowId": window.window_id,
					"bookId": book_id,
					"chapterNo": no,
					"source": source,
					"lineIndexes": [u.line_index for u in window.units],
					"texts": list(texts),
					"features": paragraph_features(texts),
				}
			)
	return records


def generated_pool(
	text: str, book_id: str = "generated", chapter_no: int = 1, source: str = "generated"
) -> list[dict]:
	"""生成物文本（```novel 块）→ 窗口记录。"""
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


def load_style_anchor(book: str, fixtures_dir: Path = DEFAULT_FIXTURES) -> str | None:
	"""fabricated/style.md 若存在则作为标注风格锚（缺省用 annotate.STYLE_ANCHOR）。"""
	path = fixtures_dir / book / "fabricated" / "style.md"
	if path.exists():
		text = path.read_text(encoding="utf-8").strip()
		return text or None
	return None


def write_jsonl(records: list[dict], path: Path) -> None:
	path.parent.mkdir(parents=True, exist_ok=True)
	with open(path, "w", encoding="utf-8") as fh:
		for rec in records:
			fh.write(json.dumps(rec, ensure_ascii=False) + "\n")


def read_jsonl(path: Path) -> list[dict]:
	with open(path, encoding="utf-8") as fh:
		return [json.loads(line) for line in fh if line.strip()]


def main(argv: list[str] | None = None) -> int:
	parser = argparse.ArgumentParser(description="书库夹具 → windows.jsonl")
	parser.add_argument("--book", default="ywjs", help="夹具别名（fixtures/books/<别名>）")
	parser.add_argument("--fixtures-dir", type=Path, default=DEFAULT_FIXTURES)
	parser.add_argument("--out", type=Path, default=Path("artifacts/windows.jsonl"))
	parser.add_argument(
		"--size",
		type=int,
		default=None,
		help="窗口段数；缺省按段长自适应（目标 ≤420 字/窗，clamp 3..8；一句一段书通常为 8）",
	)
	parser.add_argument("--step", type=int, default=None, help="滑窗步长；缺省 size//2")
	args = parser.parse_args(argv)

	book_path = args.fixtures_dir / args.book / "book.json"
	if not book_path.exists():
		raise SystemExit(f"夹具不存在：{book_path}（evals 里先 pnpm fixture:build 或 scripts/import_book.py）")
	book = json.loads(book_path.read_text(encoding="utf-8"))
	lengths = [len(p["text"]) for p in book["paragraphs"]]
	avg = max(sum(lengths) // max(len(lengths), 1), 1)
	size = args.size or max(3, min(8, round(420 / avg)))
	step = args.step or max(1, size // 2)
	records = build_book_windows(book_path, size=size, step=step)
	write_jsonl(records, args.out)
	hist: dict[str, int] = {}
	for rec in records:
		hist[rec["source"]] = hist.get(rec["source"], 0) + 1
	print(
		f"{args.book} → {args.out}：{len(records)} 窗（{hist}），"
		f"特征维度 {len(FEATURE_KEYS)}，总段数 {sum(len(r['texts']) for r in records)}"
	)
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
