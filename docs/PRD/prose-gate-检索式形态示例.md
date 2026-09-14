# 书库风格示例库与写作注入（生产端）PRD

- 版本：v0.4（2026-09-12，v0.2 主体 + v0.4 工具通道均已实施，见 §9-10）
- 上游：`prose-gate-段级缺陷判官.md`（路线①判官 = training 侧主线，与本 PRD 解耦）；`prose-gate-训练数据工作台.md`（判官训练数据宿主，不受本 PRD 影响）
- 背景：六路线讨论中的 ④——写作时把参考书"强风格段"作为 few-shot 形态范例注入写作 prompt，从源头提升生成文本的形态质量（段落节奏、叙述腔、对话密度）。用户定调：这是**写作时能力，属于生产端 server 侧**；training 侧只做①判官。

## 1. 背景与问题

1. **形态靠抽象指令约束弱**：抽象规则（"每段约 X 字""对话要生动"）服从率有限；模型对"照着例子写"的服从率远高于对抽象规则——few-shot 范例是最直接的风格载体；
2. **风格是局部模式，示例即风格**：网文的叙述腔、对话密度、节奏感大量存在于具体段落中；
3. **用户需求形态（已确认）**：用户提供书本 → 解析入库 → LLM 提取**有强烈风格的原文段** → 抽象**场景召回关键字** → 混合检索注入写作；
4. **嵌入模型内置 server**（用户定调）：检索的向量路在本地运行时内完成，零网络、零外部服务。

## 2. 目标 / 非目标

**目标**

1. 完本书导入书库时**自动构建 per-book 风格示例库**（LLM 策展强风格段 + 风格标签 + 场景关键字 + 本地 ONNX 嵌入），落 `analysis/` 资产域；
2. 写作时**混合检索**（关键字 ∪ 向量 → RRF 融合）取 2-3 段注入写作 prompt，**双缝生效**（Compose 子代理 spawn seed + main agent 动态 prompt 段）；
3. 嵌入模型（bge-small-zh-v1.5 ONNX q8）内置 server，懒加载单例，默认关、验证后转正。

**非目标**

- 不动 `training/prose_gate`：判官管线与工作台负样本生成**不引入示例注入**（判官训练分布不受影响）；
- 不加任何质量指令（"避免套话"之类）——示例只教**形态**（段落节奏/叙述腔/对话密度）；
- 不做示例段的网页编辑（库可重建；GUI 抽查/重建入口列为后续，见 O5）；
- v1 不做多书混检、不做"以本书续写"的同章过滤（见 §4.2）。

## 3. 总体流程与既有设施

```
【阶段一：建库（每书一次，导入后自动，后台异步）】
parseBookText 已产出 paragraphs/<批id>.md（3500/6000 字批）
  → 按章分层轮转抽样 1000 个段落组
  → LLM 策展：每次调用喂 10 组（全书 ≈100 次直连 provider 调用，非 agent 循环）
      每组可出 0-2 段强风格段；不强制产出，空批合法
  → 子串硬校验（照抄段必须是该组原文子串，防 LLM 改写）
  → 入库 <libraryRoot>/<bookId>/analysis/stylelib.json + stylelib.emb（本地 ONNX 嵌入）
  → book.meta.json 记状态；重建幂等整库覆盖

【阶段二：写作时检索注入（默认关，env 开）】
写作焦点 = 当前 story_unit（title/intent/synopsis）+ leaf plan（人物/地点/事件/节拍）
  NovelWrite/NovelEdit 写入时更新 per-conversation 焦点缓存
  → 检索：关键字（要素整词+2-gram）∪ 向量（同编码器余弦 top-8）→ RRF → 标签多样性 → top-2-3
  → 注入：Compose spawn seed（<novel-style-guide>）+ main 动态段（novel.stylelib）
```

**与既有设施的关系**（不合并、互补）：

- `analysis/highlights.jsonl`（BookAnalyst 副产物）：agent 会话产出、有 tags 但无嵌入、无场景关键字、量级随 agent 行为波动——保留不动；stylelib 是确定性管线、成本可控、带检索字段，两者将来可交叉校验；
- `.novel/cases` + composeGuide（`<novel-guide>`）：**通用方法论案例**（正文撰写案例等 15 份母版）vs 本 PRD 的**用户自己这本书的风格段**——互补不替代，注入机制同款（spawn seed）；
- `analysis/style.md`：抽象风格描述 vs 具体段落示例，互补。

## F1 建库（导入管线，确定性步骤）

- **触发与时机**：`BookImportService.importBook` 解析落盘后异步触发独立建库步（`library/stylelib/build` 新模块），与 BookAnalyst 后台会话互不阻塞；`book.meta.json` 增 stylelib 状态（`未建/建库中/已建 N 段/失败`）；失败不阻塞导入，可手动重建；重建幂等（整库覆盖，tmp+rename 原子写）；
- **候选抽样**：段落组 = `paragraphs/<批id>.md`，章归属来自 parse 结构（卷/章切分结果）；**按章分层轮转抽 1000 组**（全书不足则全取），确定性无随机——跨章均匀铺开，wudao 级（754 章）每章约 1-2 组；
- **策展调用**：`LlmIntentClassifier` 同款直连模式——`createProvider({ id: "stylelib-curator", ...runtimeProviderConfig(...), timeoutMs })` + `thinking:"off"` + maxTokens 夹紧（4096）；每次调用 10 组，串行或小并发（≤4）；
- **策展 prompt**（一次调用完成筛选+标签+关键字，输出 JSON）：
  - 每组渲染为 `【组 N】<paragraphId 区间>（第 X 章）` + 段落列表；
  - 任务：在 10 组间**横向比较**，只挑真正强风格段（对话灵动/白描有味/节奏鲜明/情绪有张力）；
  - 纪律：**不强求每组都有产出、允许空数组**；`text` 必须整段原文照抄，不得改写；
  - 输出：`{"selections": [{"group": N, "text": "…", "styleTag": "六选一", "keywords": ["…", …]}]}`；
  - `styleTag` 枚举：`对话吐槽 / 环境白描 / 打斗 / 情绪爆发 / 日常闲笔 / 叙事推进`；
  - `keywords` 3-6 个场景召回词：场景类型词 + 关键物象（"对峙""雨夜""茶馆""初见""拆招"）；
- **硬校验**（解析后逐条）：归一空白后先匹配"等于该组某自然段"，退而"为该组拼接文本的子串"，再不行丢弃计数；组序号越界、styleTag 非法、长度越界（<20 或 >150 字）均丢弃计数；`(group, text)` 去重；
- **入库 schema**（`analysis/stylelib.json`）：

```json
{"schema": 1, "bookId": "…", "builtAt": "…", "model": "deepseek-v4-flash", "stats": {"candidates": 1000, "kept": 233, "dropped": {"notSubstring": 4, "tooLong": 2, "tooShort": 1}, "tags": {"对话吐槽": 58, "…": 0}},
 "paragraphs": [
   {"id": "<bookId>-sl-0001", "paragraphId": "<bookId>-p000123", "chapterNo": 12,
    "text": "段原文", "styleTag": "对话吐槽", "keywords": ["寝室闲聊", "互相伤害"]}
 ]}
```

- **嵌入文件** `analysis/stylelib.emb`：Float32 二进制（N × 512，行序同 paragraphs），stdlib `DataView`/`Float32Array` 可直读，零解析依赖。

## F2 嵌入模型内置 server

- **选型**：`@huggingface/transformers`（Node 后端 onnxruntime-node）+ `onnx-community/bge-small-zh-v1.5-ONNX` **q8 量化（约 24MB；fp32 约 91MB 备选）**；512 维、单文本最长 512 token；与 training 侧 Python 同源模型（虽无跨端共享需求，语义对齐便于将来对照）；
- **分发**：模型文件入 `core/resources/models/bge-small-zh-v1.5-ONNX/`，走既有 `copy-resources.mjs` 构建拷贝进 dist（agent-cases 先例）；"首用下载"为备选（见 O2）；
- **运行时**：conversation 子进程（`ELECTRON_RUN_AS_NODE=1` 纯 Node，Node ≥22 / Electron 43）内**懒加载单例**（首次建库嵌入或检索时加载）；预算：冷启动约 1-3s、常驻内存约 100-200MB；建库批量嵌入（150-400 段，CPU 秒级-分钟级）与检索查询嵌入（单条短文本，热态 <100ms）共用单例；
- **原生模块风险**（如实记录）：onnxruntime-node 随 node_modules 解析，与既有 zeromq 原生模块同路；但仓库尚无 electron-builder/asar 打包层，未来引入安装包时需补原生模块 unpack 处理——非阻塞，实施时验证 dev 运行即可；
- **兜底**：嵌入封装在 `EmbeddingProvider` 接口后（`embed(texts) -> Float32Array[]`）；原生依赖不可用时检索降级纯关键字路（算法不绑死向量）。

## F3 检索与注入（写作时）

- **书源**：`.novel/library.json` 白名单内参考书（`LibraryAccessPolicy`，默认空 = 不可见）；v1 单书（白名单首本），多书混检见 O5；
- **写作焦点**：NovelWrite/NovelEdit 工具执行时更新 per-conversation 焦点缓存（kind=story_unit/paragraph/chapter + story_unit_id——工具侧天然知道）；检索查询 = `story_unit.title/intent/synopsis` + `leaf_story_unit_plans.plan_json`（LeafPlan 的 events/characters/locations/rhythmBeats）文本化；无焦点（纯设定写作等）不注入；
- **检索**（`library/stylelib/retrieve` 新模块）：
  1. 关键字路：查询词 = 要素整词 + 2-gram（滤纯函数字 2-gram：的了是在和与也都被把不有一…）；命中 = 出现于 `text + keywords` 拼串；条目 keyword 整词出现在要素值中算强命中（×2）；按命中数取前 16；
  2. 向量路：查询嵌入（要素各成一段后均值再归一）与库内向量余弦 top-8；
  3. RRF 融合 `Σ 1/(60+rank)`；标签多样性：top-2-3 尽量异 styleTag（同标签只留最优，次优让位）；
- **注入两缝**：
  1. **Compose spawn seed**：`composeGuideSeed`/`spawnSeedMessages` 现成缝（`AgentLoop` 首 run 一次、紧随 user 消息），包装 `<novel-style-guide>` system 消息——检索词取自委派 prompt 可用要素；
  2. **main 动态段**：`novelSections` 注册表新增动态段（如 `novel.stylelib`），`LoopContext` 新增 provider（`caseGuideProvider` 同款接线）；段内按**焦点指纹**缓存（story_unit_id + plan 内容变更失效），避免每次 provider call 重检索；
- **注入文案形态**：

```
<novel-style-guide>（取自书库参考书，仅示范段落节奏与叙述腔，禁止复用其内容词句）
示例·对话吐槽（寝室闲聊、互相伤害）：
  "丑媳妇总得见公婆，你总不能在校门口站成望夫石吧？"蔡宗明一巴掌拍上他肩头。
示例·环境白描（雨夜街道）：
  雨下了三天，青石板泛着水光，茶馆的灯在风里晃。
</novel-style-guide>
```

- **开关**：env `NOVEL_STYLELIB_INJECT`（仿 `NOVEL_COMPOSE_GUIDE_CLASSIFY` 先例，`/^(1|true)$/i`，**默认关**）；关闭时零残留（不加载模型、不检索、不注入、不注册 provider 工作）；验证后考虑升级进 RuntimeSettings。
- **工具通道（v0.4）**：`StylelibSearch` 延迟工具——与自动注入同库同开关，经 `runtime.external` 两步接入（`SearchExtraTools` 发现 → `ExecuteExtraTool` 执行），供 agent 写作前**主动**检索更多/更定向的范例（自动注入只给 top-2，工具可 `style_tag` 过滤、`limit` 到 10）。受信只读免审（无 `requireApproval`）；description 自足（含两步调用方式与防复用纪律——延迟工具的 promptDetail 不渲染）；main agent 专属（external 池不进 Compose/Explore）；无库/未建库/无命中均降级为提示文本不抛错。

## 4. 数据与防复用纪律

1. **示例只教形态不教质量**：注入文案无任何反缺陷指令；
2. **同源边界**：参考书（书库完本）与创作项目正文天然不同源，training 版"排除同章"不适用；未来若支持"以本书续写"（本书既在项目又在书库）需补同源过滤；
3. **防改写**：入库段全部经子串硬校验，示例即原文；
4. **成本透明**：建库 ≈100 次 LLM 调用（10 组/次 × 1000 组），导入后台异步执行，失败不阻塞导入与 BookAnalyst；
5. **可重建**：示例库幂等整库覆盖，不影响 book.db 与 analysis 其他资产（style.md/excerpts.md/highlights.jsonl）。

## 5. 测试计划

- **单元**（沿用 core 既有测试框架）：抽样确定性与跨章分层；策展 prompt 构造；解析 + 子串硬校验（拒改写段/越界组号/非法标签/长度越界/去重）；RRF 融合排序；标签多样性让位；焦点指纹缓存失效；注入文案渲染（含"禁止复用"声明）；
- **集成**：fake provider（策展回复三分支）+ fake EmbeddingProvider（确定性向量）走完 建库 → 检索 → 注入 断言；**零模型依赖、零网络**；
- **手工验收**：真实导入一本书建库，抽查检索贴切度与开关 A/B 生成对比。

## 6. 实施步骤（PRD 定稿后另排，非本轮）

1. `core/src/library/stylelib/` 新模块三件：`build.ts`（抽样→策展→校验→落盘）、`embed.ts`（EmbeddingProvider + ONNX 懒加载单例）、`retrieve.ts`（关键字∪向量 RRF + 多样性）；
2. 资源与依赖：模型入 `core/resources/models/`、`copy-resources.mjs` 验证、引入 `@huggingface/transformers`；
3. 建库接线：`BookImportService` 触发 + `book.meta.json` 状态；
4. 注入接线：NovelWrite/NovelEdit 焦点缓存 → Compose seed + main 动态段 + `NOVEL_STYLELIB_INJECT` 开关；
5. 测试全绿 → 真实冒烟：导入 wudao 建库（≈100 次策展调用）→ "迎新会紧张"类焦点检索抽验 → 开关 A/B 生成对比段落粒度/对话密度。

## 7. 验收

1. **建库**：导入完成后 `analysis/stylelib.json + stylelib.emb` 落地；段数 150-400 量级、全部原文子串、标签分布合理；
2. **检索**：给"迎新会紧张"类场景焦点，召回对话/日常类示例而非无关打斗段；
3. **注入**：开关开启时 Compose spawn 与 main 动态段可见 `<novel-style-guide>`；关闭时零残留（无检索调用、无模型加载）；
4. **嵌入**：本地推理零网络；热态查询嵌入 <100ms；建库全量嵌入完成；
5. **回归**：core 既有测试全绿。

## 8. 开放问题

- O1 q8 vs fp32 召回质量：q8 先行，检索贴切度不足时换 fp32（体积约 ×4）；
- O2 模型分发：随包内置（约 24MB）vs 首用下载（需新增下载机制，仓库现无大文件运行时下载先例）；v1 内置；
- O3 多 conversation 内存：每子进程各载一份嵌入单例；会话并发多时改 Electron utility process 共享；
- O4 建库时机：导入即建 vs 加入白名单/首次注入时惰性建；v1 导入即建；
- O5 多书混检与书选择 UX；GUI 抽查/重建入口；
- O6 焦点粒度：story_unit 级 vs 章节级 vs paragraph 级，按实测贴切度调。

## 9. 变更记录

- v0.4（2026-09-12）：**工具通道**——`StylelibSearch` 延迟工具（runtime.external 两步接入，agent 主动检索风格示例；`retrieve` 支持 `onlyTags` 标签过滤；用户定参：仅示例库、与注入同一开关）。受信只读免审、main 专属、description 自足。
- v0.3（2026-09-12）：**v0.2 实施落地**（记录见 §10），版本行转"已实施"。
- v0.2（2026-09-12）：**生产端转向重写**。④从 training 工作台（负样本生成注入）迁至生产端 server：建库挂书库导入管线（`analysis/` 资产域、`BookImportService` 触发）、策展批量 10 组/次 × 1000 组候选（不强制每组产出）、嵌入模型内置 server（`@huggingface/transformers` + onnx-community bge-small-zh-v1.5-ONNX q8，懒加载单例）、注入双缝（Compose `spawnSeedMessages` + main 动态段）、env 开关默认关。用户定调：training 侧只做①判官，本 PRD 与 training/prose_gate 解耦。v0.1 未实施即转向。
- v0.1（2026-09-12）：training 工作台方案初稿（工作台建库 + 负样本生成注入 + 两段式标注页追溯），已被 v0.2 取代。

## 10. 实施落地记录（v0.3，2026-09-12）

按 §6 五步全部落地；`clients/desktop/core` 一域收口，零外部服务依赖。

**建库执行链**

- `src/library/stylelib/`（新）：`types.ts`（常量与契约单一来源：六标签枚举、CANDIDATE_TARGET=1000 / CURATION_BATCH=10 / 段长 20-150 / RRF_K=60 / 双路 top-8/16 / 注入 top-2）；`sample.ts`（manifest 按章轮转抽样，确定性）；`curate.ts`（批量策展 prompt + 解析 + **子串硬校验**：归一空白等段 → 批文子串 → 丢弃计数，组号/标签/长度/去重各计其罪）；`embed.ts`（`EmbeddingProvider` 接口 + `OnnxEmbeddingProvider` 懒加载 + `FakeEmbeddingProvider`）；`retrieve.ts`（`loadStylelibIndex` mtime 缓存、`resolveStylelibBook` 白名单首书、关键字∪向量 RRF + 标签多样性、注入块渲染）；`build.ts`（编排：单批失败重试一次后放弃不阻断、无向量建库清残留 emb、tmp+rename 原子写）；`StylelibBuildRunner.ts`（`ImportProcessRunner` 同款一次性子进程：argv JSON 任务 + stdout 行协议 + meta.stylelib 状态机 未建→建库中→已建/失败，每书串行并发去重，无 key 不 spawn）。
- `scripts/stylelib-worker.mjs`：子进程入口（provider 经 env 继承 `NOVEL_PROVIDER_*`；策展采样 thinking off / maxTokens 4096 / 超时 300s；嵌入缺模型降级 vectorless）。
- 接线：`LibraryPaths` +`stylelibFilePath`/`stylelibEmbPath`；`BookMeta` +`stylelib?` 状态字段；`BookImportService` +可选 stylelib 面（导入成功 fire-and-forget，与 BookAnalyst 会话并行）；`minimal.ts` 惰性构造 runner 传入 + **书库根写进 main env**（`NOVEL_PROVIDER_*` 同款先例，全部子进程经 spawn env 继承）。

**嵌入模型内置（O2 定参：gitignore + fetch 脚本）**

- `@huggingface/transformers` v4.2.0（`onnxruntime-node` 后端；pnpm allowBuilds 已放行 postinstall）；模型 `scripts/fetch-stylelib-model.mjs` 从 HF 拉取（`HF_ENDPOINT` 镜像支持；仓库实测文件 = config/tokenizer/tokenizer_config + `onnx/model_quantized.onnx(.onnx_data)`，q8 约 24MB 外置 data 格式，无 special_tokens_map.json）；`resources/models/` gitignored（training/models 同惯例）；目录解析 = env `NOVEL_STYLELIB_MODEL_DIR` → 自模块目录上探 5 层（agentCases 同款）。
- Windows 实测：冷启动（含加载+首查）195ms、热态单查 3ms、512 维 L2 归一正确——远优于验收线（热态 <100ms）。

**注入侧（默认关，零残留）**

- 段链：`PromptSection` +`StylelibGuideSnapshot`/`StylelibProvider`；新动态段 `novel.stylelib@1.0.0`（快照缺失空串省略）；`novelSections` 注册表 27→28 段；main recipe 15→16 段（`novel.prose_standard` 后），definitionVersion 1.5.0→**1.6.0**（golden 夹具 `protocol/fixtures/definition-novel-1.6.0.json` 再生成，publish-bundle/Android 对拍测试同步改名）。
- Provider 链：`loop/types` +`stylelibProvider` → `LoopContext`（每 call 调用、默认 no-op）→ `NovelAgent` 选项透传——caseGuideProvider 全链复刻。
- 焦点：`WritingFocusStore`（todoStore 同款会话共享件）；`NovelWrite`/`NovelEdit` 工具成功执行后记录（paragraph 取 storyUnitId；story_unit 取自选/结果回传 id；chapter 取来源提示；`recordFocusFromCall` 纯函数可测）；`NovelToolGroups` options 透传。
- 装配：`createStylelibProvider`（焦点指纹缓存 = bookId+storyUnitId+库 mtime；查询文本 = story_unit title/intent/synopsis + leaf 事件/节拍情绪/绑定备注，截 600 字；嵌入懒建共享单例）+ `createStylelibSeed`（Compose：委派 prompt 前 400 字检索，`<novel-style-guide>` 消息）+ `combineSeedMessages`（与既有 composeGuideSeed 合成，guideOnce memo 语义保留）；entrypoint 按 `NOVEL_STYLELIB_INJECT` 开关接线（非 novel 会话/无库根不接线）。

**测试与验收**

- 新增 35 例（抽样确定性/分层、策展 prompt 与解析校验五类丢弃、RRF/多样性/函数字过滤/降级、build 全链含子串保证与幂等重建、runner 行协议/状态机/并发去重/无 key、焦点提取四路径、provider 缓存与降级、seed 包装与合成、LoopContext 装配零残留、BookImportService fire-and-forget）；core 全量 **123 文件 / 1003 测试全绿**，typecheck 过；minimal.ts esbuild + gui tsc 复验过（gui 既有 @novel/ui 未构建报错与本次无关）。
- 真实冒烟：wudao 全书（755 章 / 908 批 / 258 万字）导入 → target=400 建库（deepseek-v4-flash 真实策展 + 本地 ONNX 嵌入，40 批 0 失败，**5.3 分钟**）→ 入库 **169 段**（标签分布：对话吐槽 69 / 情绪爆发 36 / 打斗 26 / 日常闲笔 19 / 环境白描 11 / 叙事推进 8；丢弃：tooLong 157 / notSubstring 18 / tooShort 4 / badGroup 1——改写拦截与超长过滤真实工作）→ 子串保证抽验通过 → 检索贴切度：「迎新会上台自我介绍紧张出丑」top1 命中本书真实的武道社迎新会室友调侃段；「雨夜独行白描」top1 为环境白描段；查询嵌入热态 1-3ms。生产默认 target=1000（约 13 分钟/书）。

**遗留与后续**

- 生产 GUI 开关/重建入口与多书选择（O5）；q8 召回质量对比 fp32（O1，抽验不贴场景时升级）；多 conversation 嵌入单例共享（O3，会话并发多时改 utility process）；焦点粒度按实测调（O6）。
- 首次真实建库入口：GUI 导入即建（meta.stylelib 可查状态）；手动重建 = `node scripts/stylelib-smoke.mjs`（或经 runner 直调）。
