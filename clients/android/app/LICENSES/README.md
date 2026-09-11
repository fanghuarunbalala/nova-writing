# res/font/nova_kai.ttf 来源与再生成

- 字体：[霞鹜文楷 LXGW WenKai](https://github.com/lxgw/LxgwWenKai) v1.520 Regular，SIL OFL 1.1
  （全文见 [lxgw-wenkai-OFL.txt](lxgw-wenkai-OFL.txt)；版权附加条款明确允许子集化再分发）。
- 本仓库打包的是**子集**：GB2312 一级汉字（3755 常用字）+ ASCII + 常用标点，约 1.7MB
  （源全量 ttf 约 23.6MB）。
- 再生成（幂等）：`clients/android` 下执行
  `pip install fonttools && python scripts/subset-font.py`
  （首次自动经 ghfast 镜像下载源字体到 `scripts/.cache/`，已 gitignore）。
- 子集外字形渲染时系统按字形自动回落 Serif，不致缺字方块。
