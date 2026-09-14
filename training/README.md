# prose-gate 文风判官训练框架

段级多标签缺陷分类判官（PRD：`docs/PRD/prose-gate-段级缺陷判官.md`）。**训练侧全 Python**：
冻结 bge-small-zh-v1.5 编码器 + 段级池化 + 8 维统计特征，双头——7 缺陷标签 logistic 头
（多标签独立概率）+ 情绪线有序头（CORAL，0-3 强度）。窗口平直/转折由情绪线派生不标注。
产物 `prose-gate-weights.v2.json` 为语言无关契约，未来 TS runtime（M3）按同契约加载。

## 训练数据工作台（推荐入口）

```bash
cd training && source .venv/bin/activate    # 或 Windows: .venv\Scripts\activate
python -m prose_gate.workbench_server       # http://127.0.0.1:8321
# 跨设备（Mac/手机连同一份磁盘进度）：python -m prose_gate.workbench_server --host 0.0.0.0
```

功能（PRD：docs/PRD/prose-gate-训练数据工作台.md）：
- **导入书**：首页上传 txt（utf-8/gbk 自动识别）→ 向导里 LLM 提取五要素大纲 → **网页编辑定稿**
  （要素 ≤100 字防泄漏护栏）→ 自适应建窗；
- **生成**：`/gen/<书>` 两种——**窗口级配对生成**（每个原文窗单独「提炼概要 → 扩写」，
  1:1 内容对齐，`pairWindowId` 映射，按章幂等替换，概要落 `<书>-window-outlines.json`）与
  **题目注入独立批次**（单栏标注，贴近生产门控）；扩写只见概要不见原文；
- **两段式标注**：`/sheet/<书>` 每窗分两部分——① 标原文窗 →「下一步」暂存原文侧（中间态可恢复）
  → ② 标「窗口概要（只读卡）+ 生成窗」（默认不见原文=独立判分，折叠可对照）→ 保存整窗两条记录；
  `标注分两部分` 下 `概览抽屉`（未标/原文已标/整窗完成/存疑四态+筛选）与 `导出抽屉`
  （命中统计+派生平直+记录样例+下载/复制）；
- **单栏独立标注**：`/label/gen/<批次>`（同卡片视觉）；
- **⚡ LLM 预标**：按当前部分预填（原文窗或生成窗），人工只校正；
- **LLM Provider 面板**（首页）：baseUrl / API Key（掩码只写不回读）/ 生成模型（提炼/扩写）/
  标注模型（预标），保存即时生效 + 测试连接；未配置回退环境变量；
- **双主题 + 移动端**：☀️/🌙 切换（localStorage），≤720px 卡片化单列 + 底部拇指栏；
  手机连同一 WiFi 访问 `--host 0.0.0.0` 打印的局域网 URL 即可标注。
  标注实时落盘 `artifacts/labels-<scope>.jsonl`（训练管线直接读），重启/换设备进度不丢。

## 标注量控制（单人预算）

1. **LLM 预标 + 人工校正**（主力，约 3–5× 提速）：⚡ 按钮预填，只改错的；防锚定——每 5 窗留 1 窗盲标对照，可顺手量化 LLM 标注质量（每标签一致率）。
2. **停标规则**：每攒 50 窗跑一次 `python -m prose_gate.embed && python -m prose_gate.train`，看 val 每标签 AUC——连续两批涨幅 < 1pt 即停（段落级目标让每窗变 8 行训练数据，300–500 窗预计够 v0）。
3. **规模化交给 LLM**（FineWeb-Edu 配方）：人工几百窗转为金标验证集，量化 LLM 标注器每标签 precision ≥ 0.9 后，LLM 批量标 5–10k 窗训练，人在金标上验收。
4. 增广后置：人标情绪线 → LLM"压平改写"制造派生平直的密集正例（StoryRMB 配方）。

## 命令行（备用）

```bash
cd training
./setup.sh            # 或 Windows: setup.cmd —— venv + pip（失败自动切清华镜像）
python scripts/fetch_model.py        # 下载 bge-small-zh-v1.5（HF → hf-mirror → ModelScope 回退）
python -m prose_gate.dataset --book ywjs           # 书库夹具 → artifacts/windows.jsonl
python -m prose_gate.embed --limit 2               # 冒烟：首两窗段级嵌入 → artifacts/embeddings.npz
python -m prose_gate.train --synthetic             # 合成数据端到端冒烟 → artifacts/prose-gate-weights.v2.json
python -m prose_gate.infer --text "他推门。\n雨还没停。\n灯芯晃了一下。"   # 推理冒烟（需真权重）
python -m pytest tests -q                          # 全部测试（含工作台集成，LLM mock）
```

## 数据流

```
evals/fixtures/books/ywjs/book.json          （章级整块文本）
  └─ dataset.py    re_split（切回一句一段）→ build_windows（8 段滑窗/步长 4/不跨章）
        → artifacts/windows.jsonl            （texts + 8 维统计特征，featureKeys 固定序）
  └─ annotate.py   LLM 标注（prompt v2：风格锚定 + 7 标签 + 情绪线 0-3 + 证据子串硬校验）
        → artifacts/labels.jsonl             （逐段 0/1 + emotion 0-3 + evidence + meta.judgeModel/promptSha256）
  └─ embed.py      冻结 bge-small-zh-v1.5，[CLS] p1 [SEP] p2 [SEP]… span 池化 + 段级 L2
        → artifacts/embeddings.npz           （windowId → n×512 float32）
  └─ train.py      torch 双头：缺陷 BCE + 情绪 CORAL 累积 BCE（阈值事后仿射重校准）；
        按书分组 8:1:1；缺陷阈值 precision≥0.9 校准 → artifacts/prose-gate-weights.v2.json
  └─ infer.py      验证：weights + 编码器 → 窗口 n×7 概率 + n 情绪线（派生平直/转折）
```

标注 LLM 的环境变量与 evals 同约定：`NOVEL_EVAL_API_KEY`（回退 `NOVEL_PROVIDER_API_KEY`
/ `ANTHROPIC_AUTH_TOKEN`）、`NOVEL_EVAL_BASE_URL`（缺省 deepseek）、
`NOVEL_EVAL_JUDGE_MODEL`（回退 `NOVEL_EVAL_MODEL` → `deepseek-v4-flash`）。

## 标注 schema v3（11 缺陷标签 + 情绪线，labels.py 单一来源）

缺陷标签：`clicheExpression` 万能套话 · `idiomStack` 四字格堆砌 · `adjPile` 修饰语堆叠 ·
`uniformSyntax` 句式同构 · `explainTelling` 直白解说 · `genericMetaphor` 万能比喻 ·
`vagueSpecificity` 空泛不具体 · `logicJump` 逻辑断裂 · `awkwardDiction` 用词错位 ·
`voiceFlat` 声音同腔 · `surfaceError` 表层瑕疵（判 1 必附原文子串证据；后四者为 v3 试标期
完备性审计新增）。每窗另有"其他"备注框（缺陷之外的问题，不判分，攒 v4 依据）。
情绪线（免证据）：逐段 0-3 绝对强度——0 平静 / 1 微澜 / 2 明显 / 3 剧烈，只描述不评价。
派生（代码可调，不进标注）：窗口平直 = max−min ≤ 1（覆盖全程死水与全程爆发两种形态）；
转折线 = 相邻差分。v1 的 `flatAffect` 逐段二元判已移除——平直是序列属性，证据不可引用。
依据：CHI2025 七类 AI 写作缺陷分类（arXiv:2409.14509，归档 `docs/reference/papers/`）
交叉验证 + 网文领域补充。清单完备性指标：试标期"其他"填写率 < 2%。

## weights JSON 契约（M3 TS 加载同款）

```
z = [h(embedding_dim) ‖ (x - mu) / sd]    # 嵌入在前、归一化特征在后
缺陷头：logit_j = W[j]·z + b[j]；P = sigmoid(logit)   # 7 标签独立，无 softmax
段判定：P_ij ≥ thresholds[j]（每标签独立阈值）
情绪头：P(强度≥k) = sigmoid(emotion_w·z − emotion_b[k])，k=1..3（CORAL，b 升序单调）
       期望强度 E = Σ_k P(≥k) → 窗口平直 = 极差 ≤ 1（labels.FLAT_RANGE_MAX，派生）
字段：schema=2 / labelsVersion / labels[11] / featureKeys[8] / embedding_dim /
      W[7][520] / b[7] / featureNorm{mu,sd} / thresholds[7] /
      emotionW[520] / emotionB[3] / encoder{tier,modelDir,maxTokens,dim}（可选，缺省=small）
      / trainData{...}
```

## 编码器档位（embed.MODEL_TIERS，large 预留未下载）

| 档位 | 模型 | 上下文 | 维度 | 状态 |
|---|---|---|---|---|
| small | bge-small-zh-v1.5（24M，MIT） | 480 token（≈420 字/窗） | 512 | 现行 |
| large | BGE-M3（~568M，MIT，ModelScope 可下） | 8000 token（8192 上限） | 1024 | 预留：整章 2000-4000 字一窗一编码，span 池化机制复用 |

- 选型理由：同厂升级用法同构；XLM-R 系 tokenizer 仍暴露 cls/sep，逐段 `[CLS] p1 [SEP]…` 池化原样可用；排除 bge-large-zh-v1.5（512 装不下整章）与 Qwen3-Embedding（decoder last-token 池化与逐段 span 架构不匹配）。
- 接线（已预留）：`dataset --tier large`（整章一窗）→ `annotate`（不变）→ `embed --tier large` → `train --tier large`（校验嵌入维度并写入 `weights.encoder`）→ infer 按 `weights.encoder` 自动选模型与 maxTokens。激活前只需 `fetch_model.py` 下载 bge-m3。

## 目录与网络说明

- `models/`（gitignored）：模型资产，`fetch_model.py` 可复现下载；仓库无 LFS，不入库。
- `artifacts/`（gitignored）：windows/labels jsonl、嵌入 npz、weights json。
- 无网络环境：`pytest` 中不依赖 torch/模型权的用例照常绿（windowing/features/annotate/
  weights 契约）；torch 用例 `importorskip`，冒烟命令待联网后执行，代码零改动。
- TODO（后续）：CI Python 腿；M0b 试标 200 窗 + 人工抽查；好文风池补书。
