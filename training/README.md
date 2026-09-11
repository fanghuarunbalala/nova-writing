# prose-gate 文风判官训练框架

段级多标签缺陷分类判官（PRD：`docs/PRD/prose-gate-段级缺陷判官.md`）。**训练侧全 Python**：
冻结 bge-small-zh-v1.5 编码器 + 段级池化 + 8 维统计特征 + 共享 8 标签 logistic 头，
输出每段 8 个独立缺陷概率（多标签）。产物 `prose-gate-weights.v1.json` 为语言无关契约，
未来 TS runtime（M3）按同契约加载。

## 训练数据工作台（推荐入口）

```bash
cd training && source .venv/bin/activate    # 或 Windows: .venv\Scripts\activate
python -m prose_gate.workbench_server       # http://127.0.0.1:8321
# 跨设备（Mac/手机连同一份磁盘进度）：python -m prose_gate.workbench_server --host 0.0.0.0
```

三模块：
- **导入书**：首页上传 txt（utf-8/gbk 自动识别）→ 向导里 LLM 提取五要素大纲 → **网页编辑定稿**
  （要素 ≤100 字防泄漏护栏）→ 自适应建窗；
- **生成**：`/gen/<书>` 选某章定稿大纲仿写（配对照），或**自定义题目注入**（独立标注，
  贴近生产门控场景）；文风基准/段落形式/批次名可调，扩写只见大纲不见原文；
- **标注**：`/sheet/<书>` 双栏配对（原文|AI）、`/label/gen/<批次>` 单栏独立——逐窗
  "保存并下一窗"自动落盘 `artifacts/labels-<scope>.jsonl`（训练管线直接读），
  重启/换设备进度不丢、已标不重标；⚑ 存疑标记、跳过、标签命中实时统计。

## 命令行（备用）

```bash
cd training
./setup.sh            # 或 Windows: setup.cmd —— venv + pip（失败自动切清华镜像）
python scripts/fetch_model.py        # 下载 bge-small-zh-v1.5（HF → hf-mirror → ModelScope 回退）
python -m prose_gate.dataset --book ywjs           # 书库夹具 → artifacts/windows.jsonl
python -m prose_gate.embed --limit 2               # 冒烟：首两窗段级嵌入 → artifacts/embeddings.npz
python -m prose_gate.train --synthetic             # 合成数据端到端冒烟 → artifacts/prose-gate-weights.v1.json
python -m prose_gate.infer --text "他推门。\n雨还没停。\n灯芯晃了一下。"   # 推理冒烟（需真权重）
python -m pytest tests -q                          # 全部测试（含工作台集成，LLM mock）
```

## 数据流

```
evals/fixtures/books/ywjs/book.json          （章级整块文本）
  └─ dataset.py    re_split（切回一句一段）→ build_windows（8 段滑窗/步长 4/不跨章）
        → artifacts/windows.jsonl            （texts + 8 维统计特征，featureKeys 固定序）
  └─ annotate.py   LLM 标注（prompt v1：风格锚定 + 8 标签 + 证据子串硬校验）
        → artifacts/labels.jsonl             （逐段 0/1 + evidence + meta.judgeModel/promptSha256）
  └─ embed.py      冻结 bge-small-zh-v1.5，[CLS] p1 [SEP] p2 [SEP]… span 池化 + 段级 L2
        → artifacts/embeddings.npz           （windowId → n×512 float32）
  └─ train.py      torch 头：BCE + pos_weight + L2；按书分组 8:1:1；阈值 precision≥0.9 校准
        → artifacts/prose-gate-weights.v1.json
  └─ infer.py      验证：weights + 编码器 → 窗口 n×8 概率
```

标注 LLM 的环境变量与 evals 同约定：`NOVEL_EVAL_API_KEY`（回退 `NOVEL_PROVIDER_API_KEY`
/ `ANTHROPIC_AUTH_TOKEN`）、`NOVEL_EVAL_BASE_URL`（缺省 deepseek）、
`NOVEL_EVAL_JUDGE_MODEL`（回退 `NOVEL_EVAL_MODEL` → `deepseek-v4-flash`）。

## 标签清单 v1（8 个，labels.py 单一来源）

`clicheExpression` 万能套话 · `idiomStack` 四字格堆砌 · `adjPile` 修饰语堆叠 ·
`uniformSyntax` 句式同构 · `explainTelling` 直白解说 · `genericMetaphor` 万能比喻 ·
`vagueSpecificity` 空泛不具体 · `flatAffect` 情绪无波动。
依据：CHI2025 七类 AI 写作缺陷分类（arXiv:2409.14509，归档 `docs/reference/papers/`）
交叉验证 + 网文领域补充。清单完备性指标：试标期"其他"填写率 < 2%。

## weights JSON 契约（M3 TS 加载同款）

```
z = [h(embedding_dim) ‖ (x - mu) / sd]    # 嵌入在前、归一化特征在后
logit_j = W[j]·z + b[j]；P = sigmoid(logit)  # 8 标签独立，无 softmax
段判定：P_ij ≥ thresholds[j]（每标签独立阈值）
字段：schema=1 / labelsVersion / labels[8] / featureKeys[8] / embedding_dim /
      W[8][520] / b[8] / featureNorm{mu,sd} / thresholds[8] / trainData{...}
```

## 目录与网络说明

- `models/`（gitignored）：模型资产，`fetch_model.py` 可复现下载；仓库无 LFS，不入库。
- `artifacts/`（gitignored）：windows/labels jsonl、嵌入 npz、weights json。
- 无网络环境：`pytest` 中不依赖 torch/模型权的用例照常绿（windowing/features/annotate/
  weights 契约）；torch 用例 `importorskip`，冒烟命令待联网后执行，代码零改动。
- TODO（后续）：CI Python 腿；M0b 试标 200 窗 + 人工抽查；好文风池补书。
