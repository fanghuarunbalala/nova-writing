"""下载 bge-small-zh-v1.5（HF 格式）到 training/models/（gitignored，不入库可复现）。

源阶梯：huggingface.co → hf-mirror.com → ModelScope；stdlib urllib，零额外依赖。
文件：config.json / tokenizer.json / tokenizer_config.json / special_tokens_map.json /
权重（model.safetensors 优先，回退 pytorch_model.bin，~95MB）。
"""

from __future__ import annotations

import argparse
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DIR = REPO_ROOT / "training" / "models" / "bge-small-zh-v1.5"

# (文件名, [候选源 URL])
def file_sources(repo_file: str) -> list[str]:
	return [
		f"https://huggingface.co/BAAI/bge-small-zh-v1.5/resolve/main/{repo_file}",
		f"https://hf-mirror.com/BAAI/bge-small-zh-v1.5/resolve/main/{repo_file}",
		f"https://modelscope.cn/models/BAAI/bge-small-zh-v1.5/resolve/master/{repo_file}",
	]


FILES: list[tuple[str, list[str]]] = [
	("config.json", file_sources("config.json")),
	("tokenizer.json", file_sources("tokenizer.json")),
	("tokenizer_config.json", file_sources("tokenizer_config.json")),
	("special_tokens_map.json", file_sources("special_tokens_map.json")),
	("model.safetensors", file_sources("model.safetensors") + file_sources("pytorch_model.bin")),
]

MIN_SIZES = {
	"config.json": 200,
	"tokenizer_config.json": 50,
	"special_tokens_map.json": 50,  # bge 该文件仅 ~125B，阈值过高会误杀
	"tokenizer.json": 100_000,
	"model.safetensors": 10_000_000,
}


def download(url: str, dest: Path, min_size: int) -> bool:
	try:
		req = urllib.request.Request(url, headers={"User-Agent": "prose-gate-fetch"})
		with urllib.request.urlopen(req, timeout=60) as resp:
			total = int(resp.headers.get("Content-Length") or 0)
			read = 0
			with open(dest, "wb") as fh:
				while True:
					chunk = resp.read(1 << 20)
					if not chunk:
						break
					fh.write(chunk)
					read += len(chunk)
					if total:
						pct = read * 100 // total
						print(f"\r  {dest.name}: {pct}% ({read >> 20}MB/{total >> 20}MB)", end="")
			print()
		if read < min_size:
			dest.unlink(missing_ok=True)
			print(f"  {dest.name}: 大小异常（{read}B < {min_size}B），弃用")
			return False
		return True
	except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as exc:
		print(f"  失败：{url} → {exc}")
		return False


def main(argv: list[str] | None = None) -> int:
	parser = argparse.ArgumentParser(description="下载 bge-small-zh-v1.5 模型资产")
	parser.add_argument("--dest", type=Path, default=DEFAULT_DIR)
	args = parser.parse_args(argv)
	args.dest.mkdir(parents=True, exist_ok=True)

	failed: list[str] = []
	for name, sources in FILES:
		dest = args.dest / name
		if dest.exists() and dest.stat().st_size >= MIN_SIZES.get(name, 200):
			print(f"[skip] {name} 已存在（{dest.stat().st_size >> 20}MB）")
			continue
		ok = any(download(url, dest, MIN_SIZES.get(name, 200)) for url in sources)
		if not ok:
			failed.append(name)
	if failed:
		print(f"✗ 未完成：{failed}（在可联网环境重跑本脚本即可续传）", file=sys.stderr)
		return 1
	print(f"✓ 模型就绪：{args.dest}")
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
