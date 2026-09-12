#!/usr/bin/env python
"""
楷体子集化：霞鹜文楷（LXGW WenKai，SIL OFL 1.1）→ app res 字体资源。

字符集 = GB2312 一级汉字（3755，涵盖 3500 常用字）+ ASCII + 常用中英标点。
产物：app/src/main/res/font/nova_kai.ttf（约 2MB）；缺失字形渲染时系统按字形回落。

用法（clients/android 下）：
  pip install fonttools
  python scripts/subset-font.py            # 首次自动下载源 ttf 到 scripts/.cache/
  python scripts/subset-font.py <源.ttf>   # 指定本地源字体

幂等：同源同字符集输出字节稳定（fontTools 不写时间戳）。
"""
import io
import os
import sys
import urllib.request

from fontTools.subset import Options, Subsetter, load_font, save_font

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(HERE, ".cache")
OUT = os.path.join(ROOT, "app", "src", "main", "res", "font", "nova_kai.ttf")

# 源字体下载地址（按序尝试）：GitHub 直连 → ghfast 镜像（国内网络）
SOURCES = [
    "https://github.com/lxgw/LxgwWenKai/releases/download/v1.520/LXGWWenKai-Regular.ttf",
    "https://ghfast.top/https://github.com/lxgw/LxgwWenKai/releases/download/v1.520/LXGWWenKai-Regular.ttf",
]


def charset() -> str:
    chars = set()
    # GB2312 一级汉字：0xB0A1–0xD7F9，3755 个常用字
    for hi in range(0xB0, 0xD8):
        for lo in range(0xA1, 0xFF):
            try:
                chars.add(bytes([hi, lo]).decode("gb2312"))
            except UnicodeDecodeError:
                pass
    # ASCII 可见字符
    chars.update(chr(c) for c in range(0x20, 0x7F))
    # 常用中英标点与符号（demo 文案/数字角标会用到）
    chars.update("·—–…、。，！？：；“”‘’（）《》〈〉「」『』【】〔〕％‰℃°×÷±≥≤≈≠←→↑↓✓✗●○◆◇■□▲△★☆")
    return "".join(sorted(chars))


def ensure_source() -> str:
    if len(sys.argv) > 1:
        return sys.argv[1]
    os.makedirs(CACHE, exist_ok=True)
    local = os.path.join(CACHE, "lxgwwenkai-regular.ttf")
    if os.path.exists(local) and os.path.getsize(local) > 1_000_000:
        return local
    last = None
    for url in SOURCES:
        try:
            print(f"downloading {url} ...")
            with urllib.request.urlopen(url, timeout=120) as resp, open(local, "wb") as f:
                f.write(resp.read())
            if os.path.getsize(local) > 1_000_000:
                return local
            last = OSError(f"size too small: {os.path.getsize(local)}")
        except Exception as e:  # noqa: BLE001 - 逐源回退
            print(f"  failed: {e}")
            last = e
    raise SystemExit(f"all sources failed: {last}")


def main() -> None:
    src = ensure_source()
    text = charset()
    opts = Options()
    opts.layout_features = ["*"]          # 保留 kern/liga 等排版特性
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    opts.recalc_bounds = True
    opts.drop_tables += ["DSIG"]
    font = load_font(src, opts)
    ss = Subsetter(options=opts)
    ss.populate(text=text)
    ss.subset(font)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    save_font(font, OUT, opts)
    print(f"subset {len(text)} chars -> {OUT} ({os.path.getsize(OUT) / 1_048_576:.2f} MB)")


if __name__ == "__main__":
    main()
