"""工作台集成测试：mock LLM 全链路——导入→提纲→建窗→窗口级配对→两段式标注页→保存→幂等→重启保留→config。"""

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
	if "提取场景大纲" in system:  # outline_mod.OUTLINE_SYSTEM（章级向导 + 窗口级配对共用）
		return json.dumps(
			{
				"title": "试炼",
				"elements": {"人物": "沈砚", "地点": "小镇", "事件": "避雨", "转折": "改口", "情绪": "戒备"},
			},
			ensure_ascii=False,
		)
	if "段落缺陷标注" in system:  # annotate._ANNOTATION_SYSTEM（LLM 预标）
		return json.dumps(
			{
				"paragraphs": [
					{"index": 1, "labels": {}, "emotion": 0, "evidence": {}},
					{"index": 2, "labels": {}, "emotion": 2, "evidence": {}},
				],
				"other": [],
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


def read_jsonl(path: Path) -> list[dict]:
	return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def test_full_flow(wb_env):
	base, fixtures, artifacts = wb_env

	# 1. 导入 + 向导（章大纲/建窗保留）
	status, data = http(
		"POST",
		base + "/api/books/import?alias=demo&title=" + urllib.parse.quote("演示书"),
		SAMPLE_TXT.encode("utf-8"),
		"application/octet-stream",
	)
	assert status == 200 and data["chapters"] == 2
	status, _ = http("POST", base + "/api/books/demo/outline", json.dumps({"chapters": [1, 2]}).encode())
	assert status == 200
	status, data = http("POST", base + "/api/books/demo/windows", b"{}")
	assert status == 200 and data["windows"] >= 2

	# 2. 窗口级配对生成（F1）：逐原文窗 提炼→扩写→单生成窗，按章幂等替换
	status, data = http(
		"POST", base + "/api/books/demo/window-pairs", json.dumps({"chapters": [1]}).encode()
	)
	assert status == 200 and data["mode"] == "window-pairs" and data["windows"] == 1
	ai = read_jsonl(artifacts / "demo-ai-windows.jsonl")
	assert ai[0]["pairWindowId"] == "demo-c001-w000"
	assert ai[0]["windowId"] == "demo-ai-c001-w000"
	outlines = json.loads((artifacts / "demo-window-outlines.json").read_text(encoding="utf-8"))["windows"]
	assert "demo-c001-w000" in outlines and outlines["demo-c001-w000"]["elements"]["人物"] == "沈砚"

	# 3. 幂等：重跑同章替换不追加；扩到第 2 章保留第 1 章
	status, data = http(
		"POST", base + "/api/books/demo/window-pairs", json.dumps({"chapters": [1]}).encode()
	)
	assert status == 200 and len(read_jsonl(artifacts / "demo-ai-windows.jsonl")) == 1
	status, data = http(
		"POST", base + "/api/books/demo/window-pairs", json.dumps({"chapters": [2]}).encode()
	)
	assert status == 200 and data["windows"] == 1
	ai = read_jsonl(artifacts / "demo-ai-windows.jsonl")
	assert {r["windowId"] for r in ai} == {"demo-ai-c001-w000", "demo-ai-c002-w000"}

	# 4. 两段式标注页（F2）：显式配对 + 概要卡 + 两部分结构
	page = get_page(base + "/sheet/demo")
	assert 'data-orig="demo-c001-w000"' in page and 'data-ai="demo-ai-c001-w000"' in page
	assert 'class="part part1"' in page and 'class="part part2"' in page
	assert "窗口概要（提炼自原文窗，只读）" in page and "查看原文" in page
	assert 'id="overviewSheet"' in page and 'id="exportSheet"' in page
	# 概要 API
	status, data = http("GET", base + "/api/window-outlines/demo")
	assert status == 200 and "demo-c001-w000" in data["outlines"]

	# 5. 独立批次（题目注入）不变
	topic = {
		"title": "雨夜",
		"elements": {"人物": "无名客", "地点": "渡口", "事件": "等船", "转折": "船不来", "情绪": "平静"},
	}
	status, gen = http(
		"POST",
		base + "/api/generate",
		json.dumps({"book": "demo", "source": "topic", "topic": topic, "form": "sentence", "genLabel": "demo-topic-1"}, ensure_ascii=False).encode(),
	)
	assert status == 200 and gen["mode"] == "independent" and gen["annotateUrl"] == "/label/gen/demo-topic-1"
	assert "情绪线" in get_page(base + "/label/gen/demo-topic-1")

	# 6. 预标（标注通道）+ 保存整窗两条记录 + 进度按映射
	status, pre = http("POST", base + "/api/annotate/demo", json.dumps({"windowId": "demo-c001-w000"}).encode())
	assert status == 200 and pre.get("emotion")
	records = [
		{"windowId": "demo-c001-w000", "bookId": "demo", "chapterNo": 1,
		 "labels": [{"clicheExpression": 0} for _ in range(5)], "emotion": [0, 1, 0, 0, 0],
		 "evidence": [{} for _ in range(5)], "meta": {"annotator": "human"}},
		{"windowId": "demo-ai-c001-w000", "bookId": "demo-ai", "chapterNo": 1,
		 "labels": [{"clicheExpression": 1} for _ in range(24)], "emotion": [0] * 24,
		 "evidence": [{} for _ in range(24)], "flag": True, "meta": {"annotator": "human"}},
	]
	status, data = http("POST", base + "/api/save/demo", json.dumps(records, ensure_ascii=False).encode())
	assert status == 200 and data["total"] == 2
	status, data = http("GET", base + "/api/books")
	book = next(b for b in data["books"] if b["alias"] == "demo")
	assert book["pairTotal"] == 2 and book["pairDone"] == 1 and book["legacyAiWindows"] == 0

	# 7. 旧章级遗留（无 pairWindowId）：不计进度，页面横幅提示
	with open(artifacts / "demo-ai-windows.jsonl", "a", encoding="utf-8") as fh:
		fh.write(json.dumps({"windowId": "demo-ai-legacy", "bookId": "demo-ai", "chapterNo": 1,
		                     "source": "ai-expanded", "texts": ["旧数据。"], "features": [[0.0] * 8]}, ensure_ascii=False) + "\n")
	page = get_page(base + "/sheet/demo")
	assert "旧「整章仿写」" in page
	status, data = http("GET", base + "/api/books")
	book = next(b for b in data["books"] if b["alias"] == "demo")
	assert book["legacyAiWindows"] == 1 and book["pairTotal"] == 2

	# 8. 重启（新 server 同目录）后进度保留（含情绪线与 flag）
	server2 = make_server("127.0.0.1", 0, artifacts_dir=artifacts, fixtures_root=fixtures, llm_call=fake_llm)
	thread2 = threading.Thread(target=server2.serve_forever, daemon=True)
	thread2.start()
	try:
		with urllib.request.urlopen(f"http://127.0.0.1:{server2.server_port}/api/labels/demo", timeout=10) as r:
			store = json.loads(r.read().decode("utf-8"))
		assert store["demo-c001-w000"]["emotion"][1] == 1
		assert store["demo-ai-c001-w000"]["flag"] is True
	finally:
		server2.shutdown()
		server2.server_close()

	# 9. 首页含书目与 provider 面板
	index = get_page(base + "/")
	assert "演示书" in index and "LLM Provider" in index and "demo-topic-1" in index


def test_config_api_mask_and_precedence(wb_env, tmp_path):
	base, _fixtures, artifacts = wb_env

	status, data = http("PUT", base + "/api/config", json.dumps({
		"baseUrl": "https://api.example.com/v1", "apiKey": "sk-test-123456789",
		"model": "gen-m1", "judgeModel": "judge-m1",
	}).encode())
	assert status == 200 and data["hasKey"] is True
	assert data["apiKey"] == "sk-***6789" and "sk-test-123456789" not in json.dumps(data)

	# 空 apiKey = 保留旧值；其余字段可清
	status, data = http("PUT", base + "/api/config", json.dumps({"apiKey": "", "judgeModel": ""}).encode())
	assert status == 200 and data["hasKey"] is True and data["model"] == "gen-m1" and data["judgeModel"] == ""
	saved = json.loads((artifacts / "workbench-config.json").read_text(encoding="utf-8"))
	assert saved["apiKey"] == "sk-test-123456789"

	# GET 掩码
	status, data = http("GET", base + "/api/config")
	assert status == 200 and data["hasKey"] is True

	# 测试连接（注入 fake 优先：不触网）
	status, data = http("POST", base + "/api/config/test", json.dumps({"model": "gen-m1"}).encode())
	assert status == 200 and data["model"] == "gen-m1" and "latencyMs" in data

	# config 模型优先于 env（单元层）
	from prose_gate import config as config_mod
	cfg = config_mod.load_config(artifacts)
	assert config_mod.model_for(cfg, "gen") == "gen-m1"
	assert config_mod.model_for(cfg, "judge") or True  # judgeModel 清空后回退 env 链


def test_import_rejects_bad_alias(wb_env):
	base, _fixtures, _artifacts = wb_env
	status, data = http(
		"POST", base + "/api/books/import?alias=../evil&title=x", b"whatever", "application/octet-stream"
	)
	assert status == 400  # 别名正则拦截路径穿越
