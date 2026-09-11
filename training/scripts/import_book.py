"""真实书 txt 导入：章节切分 → book.json（与 evals FixtureBookJson 同构）。

真实书不入仓库（版权）：输出目录落在 evals/fixtures/books/<别名>/，已被
.gitignore 的 `evals/fixtures/books/*`（!ywjs 白名单外）整体忽略。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CHAPTER_RE = re.compile(r"^第\s*[0-9零一二三四五六七八九十百千]+\s*章\s*(\S.*)?$")


def parse_book(txt: str) -> list[dict]:
	"""按章标题行切章，非空行去缩进为段；返回 [{no, title, paragraphs:[str]}]。"""
	chapters: list[dict] = []
	current: dict | None = None
	for raw in txt.splitlines():
		line = raw.strip().replace("\u3000", " ").strip()
		if line == "":
			continue
		match = CHAPTER_RE.match(line)
		if match:
			title = (match.group(1) or "").strip()
			current = {"no": len(chapters) + 1, "title": title or line, "paragraphs": []}
			chapters.append(current)
			continue
		if current is not None:  # 正文（书名/简介等前置杂项跳过）
			current["paragraphs"].append(line)
	return [c for c in chapters if c["paragraphs"]]


def read_text_auto(path: Path) -> str:
	"""中文小说 txt 常见 GBK 系编码：utf-8 失败回退 gb18030。"""
	try:
		return path.read_text(encoding="utf-8")
	except UnicodeDecodeError:
		return path.read_text(encoding="gb18030", errors="replace")


def build_book_json(txt_path: Path, alias: str, title: str) -> dict:
	chapters = parse_book(read_text_auto(txt_path))
	if not chapters:
		raise SystemExit("未解析到任何章节（检查章标题格式）")
	paragraphs = []
	for chapter in chapters:
		for seq, text in enumerate(chapter["paragraphs"], start=1):
			paragraphs.append(
				{
					"id": f"{alias}-p{len(paragraphs) + seq:06d}",
					"chapterNo": chapter["no"],
					"chapterTitle": chapter["title"],
					"chars": len(text),
					"text": text,
				}
			)
	volumes = [
		{
			"no": 1,
			"title": None,
			"chapters": [
				{"no": c["no"], "title": c["title"], "batchIds": []} for c in chapters
			],
		}
	]
	return {
		"schema": 1,
		"alias": alias,
		"title": title,
		"sourceSha256": hashlib.sha256(txt_path.read_bytes()).hexdigest(),
		"builtAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
		"stats": {
			"volumes": 1,
			"chapters": len(chapters),
			"batches": len(paragraphs),
			"chars": sum(p["chars"] for p in paragraphs),
		},
		"volumes": volumes,
		"paragraphs": paragraphs,
	}


def main(argv: list[str] | None = None) -> int:
	parser = argparse.ArgumentParser(description="真实书 txt → book.json（gitignored）")
	parser.add_argument("txt", type=Path)
	parser.add_argument("--alias", required=True)
	parser.add_argument("--title", default=None)
	parser.add_argument("--out-root", type=Path, default=REPO_ROOT / "evals" / "fixtures" / "books")
	args = parser.parse_args(argv)

	book = build_book_json(args.txt, args.alias, args.title or args.alias)
	out_dir = args.out_root / args.alias
	out_dir.mkdir(parents=True, exist_ok=True)
	(out_dir / "book.json").write_text(json.dumps(book, ensure_ascii=False), encoding="utf-8")

	lengths = [p["chars"] for p in book["paragraphs"]]
	print(
		f"{args.alias}《{book['title']}》：{book['stats']['chapters']} 章 / "
		f"{len(lengths)} 段 / {book['stats']['chars']} 字；"
		f"段长 avg={sum(lengths)//len(lengths)} max={max(lengths)} → {out_dir / 'book.json'}"
	)
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
