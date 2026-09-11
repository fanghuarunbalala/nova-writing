"""工作台集成测试：mock LLM 全链路——导入→提纲→定稿→建窗→生成（独立/配对照）→标注→重启保留。"""

from __future__ import annotations

import json
import threading
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import pytest

from prose_gate.workbench_server import make_server

SAMPLE_TXT = (
	"第1章 试炼\n雨下了三天。\n他背着刀进的镇。\n没有人拦他。\n茶馆灯还亮着。\n\n"
	"第2章 夜行\n灯灭了。\n他推门。\n屋里没有别人。\n雨更大了。\n"
)


def fake_llm(system: str, user: str, model: str, max_tokens: int = 2048) -> str:
	if "提取场景大纲" in system:  # outline_mod.OUTLINE_SYSTEM
		return json.dumps(
			{
				"title": "试炼",
				"elements": {"人物": "沈砚", "地点": "小镇", "事件": "避雨", "转折": "改口", "情绪": "戒备"},
			},
			ensure_ascii=False,
		)
	# expand_mod.EXPAND_SYSTEM（"按给定大纲写正文"）
	return "\n".join(f"生成第{i}行，他往前走了一步。" for i in range(24))


@pytest.fixture()
def wb_env(tmp_path: Path):
	fixtures = tmp_path / "books"
	artifacts = tmp_path / "artifacts"
	server = make_server(
		"127.0.0.1", 0, artifacts_dir=artifacts, fixtures_root=fixtures, llm_call=fake_llm
	)
	thread = threading.Thread(target=server.serve_forever, daemon=True)
	thread.start()
	yield f"http://127.0.0.1:{server.server_port}", fixtures, artifacts
	server.shutdown()
	server.server_close()


def http(method: str, url: str, data: bytes | None = None, ctype: str = "application/json"):
	req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": ctype})
	try:
		with urllib.request.urlopen(req, timeout=10) as r:
			return r.status, json.loads(r.read().decode("utf-8"))
	except urllib.error.HTTPError as exc:
		return exc.code, json.loads(exc.read().decode("utf-8"))


def get_page(url: str) -> str:
	with urllib.request.urlopen(url, timeout=10) as r:
		return r.read().decode("utf-8")


def test_full_flow(wb_env):
	base, fixtures, artifacts = wb_env

	# 1. 导入（raw txt bytes + query 参数）
	status, data = http(
		"POST",
		base + "/api/books/import?alias=demo&title=" + urllib.parse.quote("演示书"),
		SAMPLE_TXT.encode("utf-8"),
		"application/octet-stream",
	)
	assert status == 200 and data["chapters"] == 2
	assert (fixtures / "demo" / "book.json").exists()
	assert (artifacts / "demo-style.md").exists()  # 默认风格锚已种

	# 2. LLM 提纲（mock）→ 草稿
	status, data = http(
		"POST", base + "/api/books/demo/outline", json.dumps({"chapters": [1, 2]}).encode()
	)
	assert status == 200 and data["units"] == 2
	assert (artifacts / "demo-units-draft.json").exists()

	# 3. 编辑定稿（PUT；要素白名单 + 截断护栏生效）
	units = [
		{
			"chapterNo": 1,
			"title": "试炼改",
			"elements": {"人物": "沈砚（编辑后）", "多余": "应被丢弃", "地点": "小镇", "事件": "避雨", "转折": "改口", "情绪": "戒备"},
		},
		{"chapterNo": 2, "title": "夜行", "elements": {"人物": "沈砚", "地点": "小镇", "事件": "夜行", "转折": "遇袭", "情绪": "紧张"}},
	]
	status, data = http(
		"PUT", base + "/api/books/demo/units", json.dumps(units, ensure_ascii=False).encode()
	)
	assert status == 200 and data["units"] == 2
	final = json.loads((artifacts / "demo-units.json").read_text(encoding="utf-8"))["units"]
	assert "多余" not in final[0]["elements"]
	assert final[0]["title"] == "试炼改"

	# 4. 建窗（短段书自适应到整章一窗，2 章 ≥2 窗）
	status, data = http("POST", base + "/api/books/demo/windows", b"{}")
	assert status == 200 and data["windows"] >= 2

	# 5. 题目注入（独立模式）
	topic = {
		"title": "雨夜",
		"elements": {"人物": "无名客", "地点": "渡口", "事件": "等船", "转折": "船不来", "情绪": "平静"},
	}
	status, gen = http(
		"POST",
		base + "/api/generate",
		json.dumps(
			{"book": "demo", "source": "topic", "topic": topic, "form": "sentence", "genLabel": "demo-topic-1"},
			ensure_ascii=False,
		).encode(),
	)
	assert status == 200 and gen["mode"] == "independent" and gen["lines"] == 24
	assert gen["annotateUrl"] == "/label/gen/demo-topic-1"

	# 6. 仿写配对照（paired 模式并入 ai-windows）
	status, gen2 = http(
		"POST",
		base + "/api/generate",
		json.dumps({"book": "demo", "source": "outline", "chapterNo": 1, "contrast": 1}, ensure_ascii=False).encode(),
	)
	assert status == 200 and gen2["mode"] == "paired" and gen2["annotateUrl"] == "/sheet/demo"
	assert (artifacts / "demo-ai-windows.jsonl").exists()

	# 7. 两个标注页可达
	page = get_page(base + "/label/gen/demo-topic-1")
	assert "demo-topic-1" in page and "chip" in page and "独立标注" in page
	assert "配对标注" in get_page(base + "/sheet/demo")

	# 8. 保存标注 + 非法 windowId 拒绝
	gen_windows = [
		json.loads(line)
		for line in (artifacts / "gen" / "demo-topic-1-windows.jsonl").read_text(encoding="utf-8").splitlines()
	]
	wid = gen_windows[0]["windowId"]
	rec = {
		"windowId": wid,
		"bookId": "demo-topic-1",
		"chapterNo": 1,
		"labels": [{"clicheExpression": 1} for _ in gen_windows[0]["texts"]],
		"evidence": [{} for _ in gen_windows[0]["texts"]],
		"flag": True,
		"meta": {"annotator": "human"},
	}
	status, data = http("POST", base + "/api/save/demo-topic-1", json.dumps([rec], ensure_ascii=False).encode())
	assert status == 200 and data["total"] == 1
	status, data = http("POST", base + "/api/save/demo-topic-1", json.dumps([{"windowId": "hack"}]).encode())
	assert status == 400

	# 9. 重启（新 server 实例同目录）后进度保留
	server2 = make_server(
		"127.0.0.1", 0, artifacts_dir=artifacts, fixtures_root=fixtures, llm_call=fake_llm
	)
	thread2 = threading.Thread(target=server2.serve_forever, daemon=True)
	thread2.start()
	try:
		with urllib.request.urlopen(
			f"http://127.0.0.1:{server2.server_port}/api/labels/demo-topic-1", timeout=10
		) as r:
			store = json.loads(r.read().decode("utf-8"))
		assert wid in store and store[wid]["flag"] is True
	finally:
		server2.shutdown()
		server2.server_close()

	# 10. 首页含书目与独立批次
	index = get_page(base + "/")
	assert "演示书" in index and "demo-topic-1" in index


def test_import_rejects_bad_alias(wb_env):
	base, _fixtures, _artifacts = wb_env
	status, data = http(
		"POST", base + "/api/books/import?alias=../evil&title=x", b"whatever", "application/octet-stream"
	)
	assert status == 400  # 别名正则拦截路径穿越
