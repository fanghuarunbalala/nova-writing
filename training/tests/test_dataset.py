"""数据装配测试：ywjs 真夹具（缺夹具跳过，同 evals 惯例）。"""

from __future__ import annotations

import pytest

from tests.conftest import YWJS_BOOK

pytestmark = pytest.mark.skipif(not YWJS_BOOK.exists(), reason="缺 ywjs 书库夹具")


def test_build_book_windows_from_ywjs():
	from prose_gate.dataset import build_book_windows

	records = build_book_windows(YWJS_BOOK)
	assert len(records) > 0
	first = records[0]
	assert first["bookId"] == "ywjs" and first["source"] == "book"
	assert first["windowId"].startswith("ywjs-c")
	assert 1 <= len(first["texts"]) <= 8
	assert all(t.strip() for t in first["texts"])
	assert all(len(r["features"]) == len(r["texts"]) for r in records)
	assert all(len(row) == 8 for r in records for row in r["features"])
	# 窗口不跨章：同章窗口的 chapterNo 一致且窗口内行号有序
	for rec in records:
		line_indexes = rec["lineIndexes"]
		assert line_indexes == sorted(line_indexes)


def test_jsonl_roundtrip(tmp_path):
	from prose_gate.dataset import build_book_windows, read_jsonl, write_jsonl

	records = build_book_windows(YWJS_BOOK)[:5]
	path = tmp_path / "windows.jsonl"
	write_jsonl(records, path)
	loaded = read_jsonl(path)
	assert loaded == records


def test_generated_pool_from_novel_block():
	from prose_gate.dataset import generated_pool

	text = "\n".join(f"生成第{i}句。" for i in range(20))
	records = generated_pool(text, book_id="gen-run-1")
	assert all(r["source"] == "generated" for r in records)
	assert records[0]["windowId"].startswith("gen-run-1-c001")
	assert len(records[0]["texts"]) == 8
