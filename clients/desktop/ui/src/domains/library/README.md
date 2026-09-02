# library 域（书库 · 完本解构）

书库视图的 UI 域（PRD `docs/PRD/library-完本解构.md` + `docs/design/app-redesign-prd.md` §8A；
视觉基准 `docs/design/app-redesign-demo.html` v0.9）。

| 模块 | 说明 |
| --- | --- |
| `store/LibraryStore.ts` | `WorkspaceDomainStore` 子类：书单 + 选中/资料位选区 + 每书部件懒加载缓存（manifest / 大纲 / 人物 / 地点 / 卷章 / 分段页 / 风格 / 摘录）；导入（pick→import）与重试解析；存在「解析中」的书时 3s 轮询 `listBooks`（走读不走推），状态翻转清该书部件缓存 |
| `hooks.ts` | `useLibrary`（useExternalStore 薄包装） |
| `viewModel.ts` | 状态 chip 映射 / 字数缩写等纯函数 |
| `components/OverviewPane` | 总览：状态时间线 + 统计卡 + 产物就绪位 + 元数据 + 解析进度/失败重试 |
| `components/OutlinePane` | 大纲（双栏）：幕级单元树 + 详情（leaf 绑定 chips 跨跳档案） |
| `components/ManuscriptPane` | 正文（双栏，融合卷章）：卷章目录 + 章头（来源幕提示）+ 分段批卡片（pid 契约 chip）+ 分页 |
| `components/EntityPane` | 人物 / 地点（双栏）：实体列表 + 档案 + 关联幕反查 |
| `components/AnalysisPane` | 风格 / 摘录：md 渲染 + pid 引用点击跳正文定位 |
| `components/ImportDialog` | 导入弹窗（宿主文件选择白名单 + 两档解析选项） |

数据经 `api.library`（`core/src/client/NovelApiClient.ts` 的 LibraryApi 面；宿主 main 经
`core/src/library/LibraryFace.ts` 组装注入，未装配时各方法降级抛 invalid-request）。
书单按工作区 allowlist 过滤（F10/F12：导入自动授权）。
