# project-import-从文件导入创建项目 PRD —— v0.3

> 状态：⏳ 待作者确认（确认后改 ✅ 已定稿）
> 关联：整体产品 PRD [`产品总览.md`](./产品总览.md)；书库全景 [`library-完本解构.md`](./library-完本解构.md)（本功能与其刻意区分，见 §2）；域概念边界 [`../development/域模型规范.md`](../development/域模型规范.md)
> v0.3 变更：**段落归属改为「随场景区间导入」（架构 v2）**——v0.2.4 的宿主事后迁移实测与解构子进程写库并发，触发 better-sqlite3 原生崩溃（0xC0000409），且「先全挂锚点再分拣」粒度为整批、场景边界错位。v2 重构：落库只建卷/章骨架+批次文件+manifest（每条含 paraStart/paraEnd 段落全书序区间）+预建 imp-saga，**不预插段落、不建锚点**；解构 agent 建完幕/场景后用专用工具 **NovelImportText**（novel.import 组，唯一经原始 handle 的受控写通道）按**段落区间**导入正文——参数只有 unitId+区间号（无文本字段），宿主从批次文件搬运原文（逐字一致红线不破）、章引用按 manifest 章区间重算回填（幂等、顺序恒正确）。场景边界精确到自然段（可跨批/跨章）；进度信号增加库内已导入段落序反查（硬信号）。旧结构项目（段落挂锚点）保留 `migrateParagraphsToScenes` 作手动兜底。prompt v2.0.0。
> v0.2.4 变更：**补「解构收尾段落归属迁移」设计缺口**——导入落库时段落全挂锚点 `imp-anchor`（「导入稿件」），但域模型要求段落挂场景级单元，两者之间无衔接（agent 被 F6 三层守卫禁止碰段落，正文永久堆在锚点下）。新增宿主确定性迁移（见 F5「解构收尾迁移」）：`importProgress` 观察 `analyzed` 后按各单元覆盖区间批量 `paragraph.update` 改挂到最深层覆盖单元，未覆盖段落保留锚点，幂等可重放。同期：导入落库预建全书根 `imp-saga`（杜绝游离顶层幕）；宿主系统对话框模态化（修「弹窗无法取消」）；UI 大纲双重编号兜底（title 自带编号时不再叠加动态序号并示「含编号」chip）。
> v0.2.3 变更：**修「解构进度恒零」真根因**——任务式导入完成后 `openDirect → workspaceApi.open → rebindWorkspace(同一 storeDir) → manager.rescope`，而 rescope 无条件 terminate 全部会话，刚派生、正在首次模型调用中的 ProjectImporter 被当场 SIGTERM（journal 停在 557 字节任务提示、status 永远 analyzing；此前「端点停滞」假说作废——全部卡死样本均为被杀）。修复：`rebindWorkspace` 对同一 storeDir 且库仍打开时幂等短路（不关库不 rescope）；PR #18 的「本进程持锁同项目幂等」不覆盖导入路径（bindFreshWorkspace 未持锁）。合并 origin/main（多实例/打开位置选择/MCP-Skills）时同步落地。
> v0.2.2 变更：**修「解构进度恒零/一直进行中」**——磁盘实证根因：模型端点偶发停滞时 provider 请求悬挂（OpenAIProvider 未配超时 → openai SDK 默认单次 10 分钟 × 静默重试 2 次 ≈ 最长 30 分钟无日志无进度，journal 停在第 1 行）。修复：后台会话（ProjectImporter / BookAnalyst）provider 配 `timeoutMs=5 分钟 + maxRetries=1`（最坏 10 分钟内出结果、错误可见）；`ImportProgress` 新增 `stalled`（analyzing 且 journal / import.json 超 10 分钟无更新），进度浮标显示「疑似卡住」并提供重试（覆盖端点停滞与应用中途关闭两种中断）。附记：实证 agent 以正斜杠路径 Read、双信号在正常会话下可用（正常样本 42 次 Read 推进至第 7 轮）。
> v0.2 变更：导入耗时操作（zip 解压/大文本解析/分批文件写/段落落库）全部移入独立后台子进程执行（`core/scripts/project-import-worker.mjs` + `ImportProcessRunner`，desktop-child 同款部署模式）——修复大文件导入时主进程事件循环被堵死、整个应用无响应的问题；预览与落库阶段进度经 `projectImport.createProgress` 轮询，导入对话框新增阶段文案 + 进度条动画。
> v0.2.1 变更：**创建改为任务式**——`createProjectFromImport` 启动即返回引用（kkrpc 默认 30s 请求超时容不下分钟级落库，长 RPC 必超时），终态（统计/解构会话/失败原因）经 `createProgress` 轮询取；`previewImport` 在 UI 侧按调用加长超时（`withCallOptions` 5 分钟，全局默认不动）；补全链路诊断日志（worker spawn/阶段/stderr 转发、解构会话派生/注册/失败、子进程装配与注册里程碑、ProcessSpawner 报到超时 kill 留痕）——「conversation 异常退出 (SIGTERM)」类问题可据此定位卡点。附修：SqliteNovelStore 可空可选列（story_unit 的 intent/synopsis/scope、character/location 的 summary 等）读回 null 透传致大纲渲染崩溃（`synopsis.replace` 黑屏）——读路径统一归一为 undefined，UI 展示层同步 null 安全（存量 bug，导入锚点单元无 synopsis 必现）。

---

## 1. 背景

- 现状：「新建项目」是全空库（仅一条 outline 种子行），已写好书稿的作者无法把存量内容变成可继续开发的项目。
- 目标（一句话）：作者选择一个 txt / zip → 预览确认卷章 → 一键创建项目——**正文与章卷 1:1 落库、手稿立即可见**；后台自动解构出大纲 / 人物 / 地点，AI 在项目内续写时即有完整上下文。

## 2. 定位与术语（与书库严格区分）

| | 书库（library-完本解构） | 本功能（项目导入） |
|---|---|---|
| 数据去向 | 全局只读书库（跨工作区参考资料） | 新项目自己的 `novel.db`（正典数据） |
| 解构 agent | BookAnalyst（完本解构分析师） | **ProjectImporter（导入解构分析师，新独立 agent）** |
| 解构产物 | 大纲 + 人物 + 地点 + 风格 md + 摘录 + 好句库 | 大纲 + 人物 + 地点 |
| 后续用途 | 对话中按需引用仿写 | 作者与 novel 主 Agent 在项目内继续写作 |

- 卷 / 章 / 段落 = 发布与正文数据，**只由宿主确定性代码导入**（章卷一致硬保证）。
- 大纲 / 人物 / 地点 = 叙事资产，由 ProjectInstaller 解构产出，**可增量生成、可重试**。

## 3. 用户故事

1. 作为作者，我选一个 txt（或 zip，内含多个分片 txt）后要先看到识别出的卷/章清单与字数，微调标题与章的归属卷再确认——落库结构必须与我原稿一致。
2. 作为作者，导入后正文一字不改、卷章结构原样进项目，手稿视图立即可见，AI 绝不「顺手润色」我的旧稿。
3. 作为作者，导入完成后系统自动开始解构（大纲/人物/地点渐进生成、进度可见），以便 AI 续写时已有完整上下文。
4. 作为作者，解构失败时（如模型未配置）正文不受影响，配置好后一键重试解构。

## 4. 功能需求

### F1 入口与流程

欢迎页「新建项目」旁新增**「从文件导入…」**按钮，流程五步：

选文件（宿主对话框，路径白名单授权）→ 解析预览（确定性，不落库）→ 微调确认 → 选项目位置（save 对话框建目录）→ 导入并打开（常规打开编排接管）。

### F2 源文件

- 支持 txt 与 zip；zip 内全部 `.txt` 条目按**全路径自然排序**（数字段按数值比较，10.txt 排在 9.txt 之后）以空行拼接为全书；非 txt 条目忽略并在预览中列出（`__MACOSX/`、`._*` 元数据静默跳过）。
- 编码自动探测：UTF-8 → GB18030 → Big5（**逐文件**探测，zip 内各分片编码可以不一）。
- 上限：单文件 20 MiB、解码后总量 20 MiB 字符、zip 条目数 ≤2000（防 zip 炸弹）。

### F3 预览与微调（导入前确认）

- 展示：源文件名、类型、总字数、卷数/章数、每章字数、zip 跳过文件清单。
- 可微调：卷标题、章标题（行内编辑）、章归属卷（下拉：任一既有卷 / 未分卷）。
- 不可微调：卷章数量与顺序（结构变动请改源文件后重新预览）。
- 防篡改：确认稿与源文件重解析结果以 key 逐一校验，不一致即拒绝（文件可能在预览后被修改）。

### F4 确定性落库（章卷一致硬保证）

- 只由宿主确定性代码写库，正文**逐字不改**（含章标记行余文，如「第一章 启程」的「启程」保留为首段）。
- 落库顺序（v0.3 骨架化）：全书根 saga（预建，title=源文件名去扩展名）→ 卷（仅有卷标记的；无卷标记则全部章不归卷）→ 章（空引用——正文引用由 NovelImportText 导入时按 manifest 章区间重算回填）。**段落不预插、不建锚点**——正文随解构时的场景区间导入（F5），逐字一致由批次文件搬运保证（含章标记行余文，如「第一章 启程」的「启程」保留为该章首段）。manifest 每条含 paraStart/paraEnd（批次段落全书序区间——导入坐标系）。
- 仅面向**空项目**（已有卷/章/大纲即拒绝）；无章标记的书走 8000 字虚拟切章（复用书库解析器行为）。
- **后台进程执行（v0.2）**：预览解析与落库（含 zip 解压、大文本解析、分批文件写、段落事务插入）全部在独立子进程完成（`ELECTRON_RUN_AS_NODE`，主进程零阻塞，窗口全程可交互）；子进程自开 novel.db 连接（先 `ensureWal`，WAL 多连接，BookAnalyst 直开 book.db 同款先例），完成即关。阶段进度（reading / parsing / writing-files n/m / writing-db n/m）经 `createProgress` 轮询驱动对话框动画；单任务串行（进行中再发起直接拒绝）。

### F5 解构必跑（ProjectImporter agent）

- 新独立 agent `ProjectImporter`（导入解构分析师），**复用 novel 主 Agent 的装配机制**（definition 注入，同一工具组目录与 prompt 注册表），仅换 prompt + 裁剪工具面（保留 todo/files/entities/**import**，去掉 ask 与 compose——后台无人值守）。
- 行为（v0.3 段落随场景导入）：通读 `.novel/import/` 的 manifest（含每批 paraStart/paraEnd 段落区间坐标系），按大轮并行读批次 → 建大纲（全书→幕→场景；幕挂预建 imp-saga、title 纯标题）+ 人物卡 + 地点卡 → **建完每个幕/场景立即用 NovelImportText 把其覆盖的段落区间导入**（参数 unitId+fromSeq/toSeq，宿主从批次文件搬运原文，一字不改；章引用自动重算回填）→ 收尾对账（各单元区间无缝覆盖全书=manifest 总段数）后把 `import.json` 的 status 置 `analyzed`（异常置 `failed` 并写明原因）。
- **区间纪律**：全书段落从 1 起连续编号（自然段粒度）；兄弟单元区间连续衔接不重叠（下一单元从上一单元 toSeq+1 起）；场景边界精确到自然段（可跨批/跨章），与章节、批次都无结构对应。
- **NovelImportText（novel.import 组）**：ProjectImporter 专用，不进主 agent。参数面**无文本字段**（unitId + 区间号）——正文只经宿主从批次文件搬运（决策 #1 红线）；经**原始（未守卫）handle** 写库（与解构会话其他写同通道、无新增并发面），通用工具直写 paragraph.\*/publication.\* 仍被守卫拦截；幂等（已导入段落跳过）；越界区间/不存在单元/旧结构 manifest（无段落坐标）报错。
- 运行形态：后台会话、bypass、任务载荷自动驱动；采样独立面（设置页可为它单独配模型，缺省低思考档——抽取型任务低档实测快 4 倍且结论一致）。
- 旧结构兜底（v0.2.4 及更早导入的项目，段落挂锚点）：`migrateParagraphsToScenes` 保留为手动迁移工具（不再自动触发——主进程写库与子进程并发的崩溃风险）。

### F6 章卷一致双保险

1. prompt 硬约束：卷/章/段落与正文一律只读。
2. **handle 守卫**（确定性）：子进程入口对 ProjectImporter 的 novel handle 直接拒绝 `publication.*` / `paragraph.*` 写操作——因为 novel.entities 的 NovelWrite 是 kind 分发通用工具，工具名级 deny 挡不住，必须在数据通道收口。agent 物理上只能写大纲/人物/地点。

### F7 进度与重试

- 进度双信号取最大：大纲 synopsis 覆盖区间标记 + 解构会话 journal 中 Read 批次的调用记录（工具调用是确定性事实）。
- 打开项目后 3s 轮询；工作台右下角浮标：解构中显示百分比/已建单元数，失败显示原因 + **重试解构**按钮；analyzing→analyzed / failed 时弹 toast。
- 重试语义：复用既有确定性产物，只补解构，不触碰正文与章卷。

### F8 失败处理

- 落库失败：整工作区回滚——关库、删工作区目录与派生存储目录、不入最近项目列表（不留半截项目）。
- 解构派生失败（provider 未配置/报到超时）：**不回滚导入**——内容已就绪，状态置 failed（原因可见），配置后重试。
- 位置对话框取消：无副作用（返回编辑态）。
- **处理中动画（v0.2）**：创建期间对话框显示阶段文案 + 进度条（读取源文件… / 解析卷章结构… / 写入拆分文件 n/m / 正文落库 n/m，不可定量阶段走不确定态），编辑输入禁用，窗口保持可用并提示勿关闭应用。
- **任务式创建与超时（v0.2.1）**：`createProjectFromImport` 启动即返回引用（不占 RPC 请求），后台链（落库 → 登记 → 派生解构）终态经 `createProgress` 轮询（succeeded 携统计/会话/spawnSkipped；failed 携原因）；任务进行中重复创建被拒。`previewImport` 由 UI 侧 `withCallOptions` 加长至 5 分钟（kkrpc 默认 30s 全局不动）。

### F9 数据与产物布局

```
<workspaceRoot>/.novel/import/
  import.json                     # importId / status(analyzing|analyzed|failed) / stats / 时间戳
  source/<原文件名>                # UTF-8 归一全文（zip 为拼接后）
  paragraphs/imp-bNNNNNN.md       # 批次文件（agent 通读单元，自然段空行连接）
  paragraphs/manifest.jsonl       # {id, chapterNo, chapterTitle, chars, file}
```

novel.db 内 id 约定：批次 `imp-bNNNNNN`、段落 `imp-pNNNNNN`、卷 `imp-vol-NN`、章 `imp-ch-NNNN`、锚点单元 `imp-anchor`；agent 自选实体 id 用 `imp-` 前缀（如 `imp-su-0001`、`imp-char-0001`）。`novel.db` 仍在 userData 派生的 storeDir，不挪动。

## 5. 验收标准

- [ ] 欢迎页三按钮：新建 / 从文件导入… / 打开其他项目…；导入流程取消任一步均无副作用。
- [ ] txt 单卷/多卷/无章标记（虚拟切章）/GBK 编码各一例：卷章结构与原稿一致，正文逐字一致（抽章 diff 为空）。
- [ ] zip 多 txt 乱序数字名：按自然序合并；非 txt 列入跳过清单。
- [ ] 超限（>20MiB 或解压超限）与空内容：明确报错，不产生任何项目。
- [ ] 预览改标题/调归属卷后落库与确认稿一致；预览后改源文件再导入被拒绝并提示重新预览。
- [ ] 向已有内容的项目导入被拒绝（空项目校验）。
- [ ] 导入完成即刻：手稿视图卷/章/正文完整可见（不依赖解构）。
- [ ] 解构自动启动；右下角浮标进度推进；大纲/人物/地点渐进出现（novel.changed 实时刷新）；完成后 import.json=analyzed + toast。
- [ ] ProjectImporter 会话内任何卷/章/段落写操作被守卫拒绝（一致性双保险生效）。
- [ ] 模型未配置时导入成功、状态 failed 带原因；配置后点重试，解构完成。
- [ ] 导入全程（预览解析与落库期间）窗口可交互、进度条推进，主进程不被堵死（v0.2）。
- [ ] 大书导入不再出现「RPC request … timed out」；创建/预览/进度各 RPC 均秒级返回（v0.2.1）。
- [ ] 导入链路日志可观测：worker spawn/阶段/stderr、解构会话派生/注册/失败、报到超时 kill 均有留痕（v0.2.1）。
- [ ] core typecheck+test、ui check+test、全量构建全绿。

## 6. 边界与不做

- 不支持向已有内容的项目导入；工作台内无导入入口（仅欢迎页）。
- 预览不支持增删卷章、重排序（只允许改标题/归卷）。
- 不产出风格 md / 摘录 / 好句库（书库专属产物）。
- ProjectImporter 会话出现在项目会话目录（与 BookAnalyst 会话同行为），v1 不做过滤。
- zip 内子目录按全路径参与排序（不把目录当卷）。

## 7. 关键设计决策（确认点）

| # | 决策 | 理由 | 可否调整 |
|---|---|---|---|
| 1 | 正文/章卷由程序确定性导入，agent 只做叙事解构 | LLM 搬运大文本无法保证逐字一致 | 结构性决策，不建议动 |
| 2 | 复用 novel 装配 + 新 definition，而非克隆 BookAnalyst | 按你的要求「直接复用 novel，只改 prompt」；装配零重复 | — |
| 3 | 裁掉 ask/compose 工具组 | 后台无人值守，ask 会挂起；compose 是写作态工具 | 可保留但无意义 |
| 4 | 解构思考档缺省 low | 书库实测 low 174s vs high 695s 且结论一致 | 设置页可按 agent 覆盖 |
| 5 | 解构失败不回滚导入，可重试 | 内容导入与智能解耦分离，失败代价最小 | 可改为「派生失败则整单失败」 |
| 6 | 段落粒度=自然段（一段一句） | 对齐 Paragraph 模型与手稿渲染 | — |
| 7 | 拆分产物放 `<workspaceRoot>/.novel/import/` | 与 .novel/library.json、.novel/cases/ 同域；按你的要求放工作区目录 | — |
