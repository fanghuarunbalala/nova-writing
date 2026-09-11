"""大纲提取测试：prompt 内容、解析健壮性（注入假 call，无网络）。"""

from __future__ import annotations

import json

import pytest

from prose_gate.outline import ELEMENT_KEYS, build_outline_prompt, extract_outline, parse_outline_reply


def test_prompt_contains_chapter_and_requirements():
	prompt = build_outline_prompt("少年壮志不言愁", "楼成来到了武道社。" * 100)
	for needle in ("少年壮志不言愁", "五要素", "人物", "转折", "JSON", "楼成来到了武道社。"):
		assert needle in prompt
	assert "…（截断）" in build_outline_prompt("t", "x" * 7000)  # 超长截断保护


def test_parse_valid_reply():
	reply = json.dumps(
		{"title": "少年壮志", "elements": {"人物": "楼成", "地点": "松城大学", "事件": "入社",
		 "转折": "从退缩到上前搭话", "情绪": "紧张兴奋"}},
		ensure_ascii=False,
	)
	parsed = parse_outline_reply(reply)
	assert parsed["title"] == "少年壮志"
	assert set(parsed["elements"]) == set(ELEMENT_KEYS)


def test_parse_missing_elements_filled_empty():
	parsed = parse_outline_reply('{"title": "x", "elements": {"人物": "楼成"}}')
	assert parsed["elements"]["人物"] == "楼成"
	assert parsed["elements"]["地点"] == ""  # 缺项置空不丢章


def test_elements_clamped_to_100_chars():
	"""防泄漏护栏：LLM 把原文成句抄进要素时截断，扩写永远看不到长段原文。"""
	long_text = "楼成" + "把原文成句抄进来了" * 12
	parsed = parse_outline_reply('{"title": "x", "elements": {"人物": "%s"}}' % long_text)
	assert len(parsed["elements"]["人物"]) == 100


def test_parse_non_json_raises():
	with pytest.raises(ValueError, match="非 JSON"):
		parse_outline_reply("这章写得不错")


def test_extract_outline_with_injected_call():
	def fake_call(system: str, user: str, model: str, max_tokens: int = 2048) -> str:
		return '{"title":"武道课","elements":{"人物":"楼成","地点":"武道社","事件":"上第一堂课","转折":"被点名报名特训","情绪":"忐忑"}}'

	outline, model = extract_outline("武道课", "正文" * 50, model="test-judge", call=fake_call)
	assert model == "test-judge"
	assert outline["elements"]["事件"] == "上第一堂课"
