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


def test_parse_valid_reply_with_evidence():
	reply = json.dumps(
		{
			"paragraphs": [
				{
					"index": 1,
					"labels": {"clicheExpression": 1},
					"evidence": {"clicheExpression": "嘴角勾起一抹冷笑"},
				},
				{"index": 2, "labels": {}, "evidence": {}},
				{
					"index": 3,
					"labels": {"explainTelling": 1},
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
	assert len(record["meta"]["promptSha256"]) == 64
