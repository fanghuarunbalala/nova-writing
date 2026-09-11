#!/usr/bin/env bash
# prose-gate 训练环境搭建（macOS/Linux）：venv + pip（默认源失败自动切清华镜像）
set -e
cd "$(dirname "$0")"

[ -d .venv ] || python3 -m venv .venv
PY=.venv/bin/python

"$PY" -m pip install --upgrade pip >/dev/null
echo "[1/2] 默认源安装..."
if ! "$PY" -m pip install -r requirements.txt; then
  echo "[2/2] 默认源失败，切换清华镜像..."
  "$PY" -m pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
fi
echo "完成。激活：source .venv/bin/activate"
