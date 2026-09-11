@echo off
rem prose-gate 训练环境搭建（Windows）：venv + pip（默认源失败自动切清华镜像）
setlocal
cd /d "%~dp0"

if not exist .venv (
  python -m venv .venv || (echo venv 创建失败 & exit /b 1)
)
set PY=.venv\Scripts\python.exe

%PY% -m pip install --upgrade pip >nul
echo [1/2] 默认源安装...
%PY% -m pip install -r requirements.txt
if errorlevel 1 (
  echo [2/2] 默认源失败，切换清华镜像...
  %PY% -m pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
  if errorlevel 1 (echo 安装失败：请在可联网环境重跑 setup.cmd & exit /b 1)
)
echo 完成。激活：.venv\Scripts\activate
endlocal
