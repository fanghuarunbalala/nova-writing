"""AI 扩写模块测试：prompt 内容约束、扩写→窗口装配（注入假 call，无网络）。"""

from __future__ import annotations

from prose_gate.expand import ai_windows_from_text, build_expand_prompt, expand_unit

UNIT = {
	"id": "ywjs-su-leaf-01",
	"title": "落雨",
	"chapterNo": 1,
	"elements": {"人物": "沈砚", "地点": "集风镇", "事件": "避雨", "转折": "改口", "情绪": "戒备"},
}


def test_prompt_has_elements_and_form_constraints():
	prompt = build_expand_prompt(UNIT, "短句成段。", target_lines=42)
	for needle in ("沈砚", "集风镇", "短句成段", "42 行", "五要素"):
		assert needle in prompt


def test_prompt_has_no_quality_instructions():
	"""刻意不给了质量/反套话指令——扩写要保留典型 AI 味（真实缺陷分布）。"""
	prompt = build_expand_prompt(UNIT, "短句成段。", target_lines=42)
	for banned in ("避免", "套话", "不要用", "避免陈词滥调", "高质量"):
		assert banned not in prompt


def test_expand_unit_with_injected_call():
	def fake_call(system: str, user: str, model: str, max_tokens: int = 2048) -> str:
		assert "场景大纲" in user
		return "\n".join(f"生成第{i}行。" for i in range(20))

	text, model = expand_unit(UNIT, 20, model="test-gen", call=fake_call)
	assert model == "test-gen"
	assert len(text.splitlines()) == 20


def test_expand_unit_retries_on_empty_reply():
	calls = {"n": 0}

	def flaky_call(system: str, user: str, model: str, max_tokens: int = 2048) -> str:
		calls["n"] += 1
		return "" if calls["n"] == 1 else "\n".join(f"第{i}行。" for i in range(10))

	text, model = expand_unit(UNIT, 10, model="test-gen", call=flaky_call)
	assert calls["n"] == 2 and len(text.splitlines()) == 10


def test_expand_unit_retries_on_too_short_reply():
	"""行数 < 目标 60% 视为过短，重试并返回合格版本（模型提前收尾防护）。"""
	calls = {"n": 0}

	def short_then_full(system: str, user: str, model: str, max_tokens: int = 2048) -> str:
		calls["n"] += 1
		if calls["n"] == 1:
			return "\n".join(f"短{i}。" for i in range(10))  # 目标 50 行的 20%
		return "\n".join(f"第{i}行。" for i in range(50))

	text, model = expand_unit(UNIT, 50, model="test-gen", call=short_then_full)
	assert calls["n"] == 2 and len(text.splitlines()) == 50


def test_expand_unit_raises_after_all_empty():
	def empty_call(system: str, user: str, model: str, max_tokens: int = 2048) -> str:
		return ""

	import pytest

	with pytest.raises(RuntimeError, match="空文本"):
		expand_unit(UNIT, 10, model="test-gen", call=empty_call)


def test_ai_windows_from_text_shape():
	text = "\n".join(f"AI 句{i}。" for i in range(20))
	records = ai_windows_from_text(text, chapter_no=1)
	assert records and all(r["source"] == "ai-expanded" for r in records)
	assert all(r["bookId"] == "ywjs-ai" for r in records)
	assert records[0]["windowId"].startswith("ywjs-ai-c001")
	assert all(len(row) == 8 for r in records for row in r["features"])


def test_regroup_paragraphs_splits_mega_blob():
	"""巨型段兜底：模型无视换行时按句重组为约 N 个均衡段（窗口级配对粒度保护）。"""
	from prose_gate.expand import regroup_paragraphs, split_sentences

	blob = "。".join(f"第{i}句测试文本内容稍长一些用于凑字数" for i in range(16)) + "。"
	assert len(split_sentences(blob)) == 16
	paras = regroup_paragraphs(blob, 8)
	assert 6 <= len(paras) <= 9  # 约 8 段（贪心预算 ±尾段合并）
	assert all(20 <= len(p) <= 80 for p in paras)
	assert "".join(paras).replace("。", "") == blob.replace("。", "")  # 内容无损
	# 短文本不过度拆分
	assert regroup_paragraphs("一句话。", 8) == ["一句话。"]
