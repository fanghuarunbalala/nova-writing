"""标注器测试：prompt 内容、假 LLM 解析、证据子串硬校验（无网络）。"""

from __future__ import annotations

import json

from prose_gate.annotate import (
	STYLE_ANCHOR,
	annotate_window,
	build_annotation_prompt,
	parse_annotation_reply,
)
from prose_gate.labels import LABEL_KEYS, PROSE_GATE_LABELS
from prose_gate.windowing import SentenceUnit, Window


def make_window() -> Window:
	units = [
		SentenceUnit(line_index=i, text=t)
		for i, t in enumerate(
			[
				"他嘴角勾起一抹冷笑。",
				"雨下了七天。",
				"他心里想：这个人得防着点。",
			]
		)
	]
	return Window("bk-c001-w000", "bk", 1, tuple(units))


def test_prompt_contains_style_anchor_and_all_labels():
	prompt = build_annotation_prompt(make_window())
	assert STYLE_ANCHOR in prompt
	for d in PROSE_GATE_LABELS:
		assert d.key in prompt and d.boundary in prompt
	assert "[1] 他嘴角勾起一抹冷笑。" in prompt
	assert "other" in prompt and "evidence" in prompt
	# v2：情绪线档位进 prompt；flatAffect 已移除（平直派生）
	assert "情绪线" in prompt and "平静" in prompt and "剧烈" in prompt
	assert "flatAffect" not in prompt


def test_parse_valid_reply_with_evidence():
	reply = json.dumps(
		{
			"paragraphs": [
				{
					"index": 1,
					"labels": {"clicheExpression": 1},
					"emotion": 2,
					"evidence": {"clicheExpression": "嘴角勾起一抹冷笑"},
				},
				{"index": 2, "labels": {}, "emotion": 0, "evidence": {}},
				{
					"index": 3,
					"labels": {"explainTelling": 1},
					"emotion": 1,
					"evidence": {"explainTelling": "他心里想：这个人得防着点。"},
				},
			],
			"other": [],
		},
		ensure_ascii=False,
	)
	result = parse_annotation_reply(reply, make_window())
	assert result.labels[0]["clicheExpression"] == 1
	assert result.labels[1] == {k: 0 for k in LABEL_KEYS}
	assert result.labels[2]["explainTelling"] == 1
	assert result.emotion == [2, 0, 1]
	assert result.errors == []


def test_emotion_clamped_and_invalid_defaults_zero():
	reply = json.dumps(
		{
			"paragraphs": [
				{"index": 1, "labels": {}, "emotion": 9, "evidence": {}},
				{"index": 2, "labels": {}, "emotion": "很激动", "evidence": {}},
				{"index": 3, "labels": {}, "evidence": {}},
			],
			"other": [],
		},
		ensure_ascii=False,
	)
	result = parse_annotation_reply(reply, make_window())
	assert result.emotion == [3, 0, 0]  # 越界截断 / 非法归零 / 缺省归零（评级不算错误）
	assert result.errors == []


def test_invalid_evidence_invalidates_label():
	reply = json.dumps(
		{
			"paragraphs": [
				{
					"index": 1,
					"labels": {"clicheExpression": 1},
					"evidence": {"clicheExpression": "这段根本不存在的文字"},
				}
			],
			"other": [],
		},
		ensure_ascii=False,
	)
	result = parse_annotation_reply(reply, make_window())
	assert result.labels[0]["clicheExpression"] == 0  # 证据非原文子串 → 作废
	assert any("证据校验失败" in e for e in result.errors)


def test_non_json_reply_all_zero_with_error():
	result = parse_annotation_reply("我觉得写得不错", make_window())
	assert all(v == 0 for row in result.labels for v in row.values())
	assert result.emotion == [0, 0, 0]
	assert result.errors


def test_out_of_range_index_recorded():
	reply = json.dumps({"paragraphs": [{"index": 9, "labels": {}, "evidence": {}}]}, ensure_ascii=False)
	result = parse_annotation_reply(reply, make_window())
	assert any("越界" in e for e in result.errors)


def test_annotate_window_with_injected_fake_call():
	window = make_window()

	def fake_call(system: str, user: str, model: str) -> str:
		assert model == "test-judge"
		return json.dumps(
			{
				"paragraphs": [
					{
						"index": 1,
						"labels": {"clicheExpression": 1},
						"evidence": {"clicheExpression": "嘴角勾起"},
					}
				],
				"other": ["节奏有点拖"],
			},
			ensure_ascii=False,
		)

	result, prompt, model = annotate_window(window, model="test-judge", call=fake_call)
	assert model == "test-judge"
	assert result.labels[0]["clicheExpression"] == 1
	assert result.others == ["节奏有点拖"]
	record = result.to_record(window, model, prompt)
	assert record["meta"]["judgeModel"] == "test-judge"
	assert record["meta"]["labelsVersion"] == "v3"
	assert len(record["meta"]["promptSha256"]) == 64
	assert record["emotion"] == [0, 0, 0]
