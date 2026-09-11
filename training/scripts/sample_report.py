"""中间取样报告：大纲 / 原文与 AI 扩写对照样例 + 窗口与特征统计 + 词表命中示例。

两版输出：
- 全量版（默认含原文段落，落 artifacts/，gitignored）——本地审阅；
- 入库版（--safe，不含真实书原文；合成书 ywjs 可加 --include-original）——
  真实书（武道宗师）原文受版权保护不进 git，入库版只保留大纲、AI 扩写样例与统计。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from prose_gate.features import FEATURE_KEYS  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
EXCERPT_PARAS = 6


def load_jsonl(path: Path) -> list[dict]:
	with open(path, encoding="utf-8") as fh:
		return [json.loads(line) for line in fh if line.strip()]


def chapter_texts_from_windows(records: list[dict]) -> dict[int, list[str]]:
	"""按章聚合原文段落（窗口有重叠，按 lineIndex 去重还原章内段落序）。"""
	chapters: dict[int, dict[int, str]] = {}
	for rec in records:
		if rec.get("source") != "book":
			continue
		no = int(rec["chapterNo"])
		bucket = chapters.setdefault(no, {})
		for li, text in zip(rec["lineIndexes"], rec["texts"]):
			bucket[li] = text
	return {no: [bucket[k] for k in sorted(bucket)] for no, bucket in chapters.items()}


def feature_table(records: list[dict]) -> list[str]:
	rows = ["| 特征 | 均值 | 最大值 | >0 段数 |", "|---|---|---|---|"]
	cols = list(zip(*(r["features"] for r in records if r.get("source") == "book")))
	total = sum(1 for r in records if r.get("source") == "book")
	for key, values in zip(FEATURE_KEYS, cols):
		flat = [v for row in values for v in row]
		rows.append(
			f"| {key} | {sum(flat) / len(flat):.3f} | {max(flat):.1f} | "
			f"{sum(1 for v in flat if v > 0)}/{len(flat)} |"
		)
	return rows


def lexicon_hits(records: list[dict], limit: int = 3) -> list[str]:
	"""词表命中示例（x3 套话 / x4 四字格），中间取样验证 lexicon 工作。"""
	out = []
	for rec in records:
		if rec.get("source") != "book":
			continue
		for i, row in enumerate(rec["features"]):
			if row[2] > 0 or row[3] > 0:
				out.append(
					f"- `{rec['windowId']}` 段{i + 1}（套话 {row[2]:.0f} / 四字 {row[3]:.0f}）："
					f"{rec['texts'][i]}"
				)
				break  # 每窗取一例
		if len(out) >= limit:
			break
	return out


def build_report(
	book: str,
	units_path: Path,
	expansions_path: Path,
	windows_path: Path,
	include_original: bool,
) -> str:
	units = {int(u["chapterNo"]): u for u in json.loads(units_path.read_text(encoding="utf-8"))["units"]}
	expansions = {int(e["chapterNo"]): e for e in load_jsonl(expansions_path)}
	records = load_jsonl(windows_path)
	original = chapter_texts_from_windows(records)

	book_windows = [r for r in records if r.get("source") == "book"]
	all_paras = [t for r in book_windows for t in r["texts"]]
	ai_summary = "，".join(
		f"第{no}章 {len([l for l in e['text'].splitlines() if l.strip()])} 行"
		for no, e in sorted(expansions.items())
	)
	lines = [f"# prose-gate 中间取样报告 · {book}", ""]
	lines += [
		f"- 原文窗口：{len(book_windows)}；总段数（去重后）：{sum(len(v) for v in original.values())}",
		f"- 平均段长：{sum(len(t) for t in all_paras) // max(len(all_paras), 1)} 字",
		f"- AI 扩写：{len(expansions)} 章（{ai_summary}）",
		"",
	]
	for no in sorted(units):
		unit = units[no]
		lines.append(f"## 第 {no} 章《{unit['title']}》")
		lines.append("")
		lines.append("**大纲（五要素，扩写唯一输入——不含原文）**")
		for key, value in unit["elements"].items():
			lines.append(f"- {key}：{value}")
		lines.append("")
		if include_original and no in original:
			lines.append("**原文段落样例（前 6 段）**")
			lines += [f"> {t}" for t in original[no][:EXCERPT_PARAS]]
			lines.append("")
		if no in expansions:
			ai_lines = [l for l in expansions[no]["text"].splitlines() if l.strip()]
			lines.append("**AI 扩写样例（前 6 段）**")
			lines += [f"> {t}" for t in ai_lines[:EXCERPT_PARAS]]
			lines.append("")
	lines.append("## 特征统计（原文侧全量）")
	lines += feature_table(records)
	lines.append("")
	if include_original:
		hits = lexicon_hits(records)
		if hits:
			lines.append("## 词表命中示例（特征管线中间取样）")
			lines += hits
	return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
	parser = argparse.ArgumentParser(description="中间取样报告")
	parser.add_argument("--book", required=True)
	parser.add_argument("--units", type=Path, required=True)
	parser.add_argument("--expansions", type=Path, required=True)
	parser.add_argument("--windows", type=Path, required=True)
	parser.add_argument("--out", type=Path, required=True)
	parser.add_argument("--include-original", action="store_true", help="包含原文段落（合成书/本地全量版用）")
	args = parser.parse_args(argv)

	report = build_report(args.book, args.units, args.expansions, args.windows, args.include_original)
	args.out.parent.mkdir(parents=True, exist_ok=True)
	args.out.write_text(report, encoding="utf-8")
	print(f"{'全量' if args.include_original else '入库(脱敏)'}报告 → {args.out}")
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
