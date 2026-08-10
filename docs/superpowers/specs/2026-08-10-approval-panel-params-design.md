# 审批面板参数展示重做（Approval Panel Parameter Display Redesign）

日期：2026-08-10
分支：`feat/gui-wiring`
范围：**仅前端** `ui/src/domains/approval/components/ApprovalPanel.tsx` + `ApprovalPanel.module.css`。不改 core、不重跑 smoke。

## 背景与问题

`ApprovalPanel` 详情区当前把工具参数用 `JSON.stringify(arguments, null, 2)` 以原始 JSON
`<pre>` 展示（`ApprovalPanel.tsx` 现有 `styles.argsBody`），视觉上是一大坨缩进文本，无法快速审阅；
同时详情区还有「大纲变更 / 正文变更 / 实体变更」三个 diff 区，对审批决策没有帮助，属噪音。

用户诉求：
1. 审批详情中的参数展示与 `vendor/index.html` 原型 `.params` 网格对齐（每行 = 中文标签 + 值）。
2. 参数 key 全部中文介绍。
3. 审批时不再展示大纲/人物/地点等变更 diff。
4. 参数是审批时的重点。

已确认决策：
- 只改右侧审批面板 `ApprovalPanel`（不动消息流内 `ApprovalCard`）。
- 嵌套结构**递归展开**（values 数组每项「第 N 项」子区块，嵌套对象递归子区块）。
- 保留「执行结果」区块。
- 枚举值也翻译成中文（未知值回退原文）。
- 工具名中文化。

## 数据模型

`arguments` 为 `JsonValue`（core `GlobalApprovalProjection["arguments"]`），即工具完整入参。
详情区按组内每条审批聚合为 `argumentGroups`：
`{ toolName: string; arguments: JsonValue }[]`。

审批工具与参数键（从 core `schemas.ts` 枚举）：

| 工具（descriptor 名） | 顶层参数 |
|---|---|
| `NovelOutlineWrite` / `NovelOutlineEdit` | `baseRevision`, `values[]` |
| `NovelCharacterWrite` / `NovelCharacterEdit` | `baseRevision`, `values[]` |
| `NovelLocationWrite` / `NovelLocationEdit` | `baseRevision`, `values[]` |
| `NovelParagraphWrite` / `NovelParagraphEdit` | `baseRevision`, `values[]` |
| `NovelVolumeWrite` / `NovelVolumeEdit` | `baseRevision`, `values[]` |
| `NovelChapterWrite` / `NovelChapterEdit` | `baseRevision`, `values[]` |
| `NovelDelete` | `baseRevision`, `cascade`, `values[]` |
| `EnterComposeMode` | `purpose` |
| `ExitComposeMode` | `{}`（无参数，配设计草稿卡） |

`values[]` 元素字段按实体类型见「PARAM_KEY_LABEL 表」。

## 改动 1：移除 diff 区

`ApprovalPanel.tsx` 内删除：
- 三个 `DiffSection` 调用（`大纲变更 / 正文变更 / 实体变更`）。
- `outlineOps / manuscriptOps / entityOps` 过滤逻辑。
- 仅被 diff 区使用的 `DiffSection` 组件、`OperationRow` 接口、`OP_SYMBOL / OP_LABEL /
  OP_KIND_LABEL / KIND_LABEL` 常量、`opClass()` 函数。
- 旧原始 JSON 展示（`.argsBody` 的 `JSON.stringify` `<pre>`），连同旧 `.args / .argsGroup /
  .argsTool / .argsBody` 相关样式（按需替换）。

目录区仍使用 `operations` 判断 `legacy`（`operations?.length === 0 && arguments === undefined`），
故 `operations` 数据保留读取，不删除。

## 改动 2：新参数渲染 `ParameterView`

在 `ui/src/domains/approval/components/` 新增 `ParameterView.tsx` 与 `ParameterView.module.css`。

### 组件签名

```ts
export interface ParameterViewProps {
  /** 待渲染的工具参数（JsonValue）。 */
  readonly value: JsonValue;
}

/** 递归把工具参数渲染为中文标签行（原型 .params 风格）。 */
export function ParameterView({ value }: ParameterViewProps): JSX.Element;
```

### 渲染规则（递归）

- `null` / `undefined` → 值显示「空」。
- 布尔 → 是 / 否。
- 数字 / 字符串 → 原样显示；字符串为已知枚举值时先过 `paramValueLabel` 翻译。
- 对象 → 若为顶层/子区块根，逐字段渲染 `.paramRow`（`.paramTag` 标签 + `.paramVal` 值）；
  对嵌套对象字段（值本身是 object 或 object[]），当前字段渲染为子区块标题（`.paramSub` 中文 key），
  再递归渲染其字段。
- 数组：
  - 空数组 → 「空」。
  - 基本值数组（string/number/boolean）→ 顿号「、」连接内联显示。
  - 对象数组 → 每个元素渲染为「第 N 项」子区块（`.paramItem`），内部字段逐行递归。
- `values` 数组元素若为「变更对象」，其字段按 `PARAM_KEY_LABEL` 翻译；其中 `id` 这类标识
  保持简短（超长省略见「显示约束」）。

### 显示约束

- 长文本（正文 text / synopsis / authorNotes / summary 等）允许折行（`overflow-wrap: anywhere`），
  超过约 6 行时用 `-webkit-line-clamp` 截断并保留展开能力（用 `<details>`/按钮切换），
  避免审批详情被长文撑爆。具体：长文默认 4 行截断，点击「展开全文」显示完整。
- `orderKey`、`baseRevision`、各类 ID 用等宽字体、`word-break`，不换行撑破布局。

### PARAM_KEY_LABEL 表（key → 中文）

公共：
| key | 中文 |
|---|---|
| `baseRevision` | 基础修订版本 |
| `values` | 变更项 |
| `value` | 变更值 |
| `id` | ID |
| `kind` | 类型 |
| `orderKey` | 顺序 |
| `description` | 描述 |
| `note` | 备注 |

角色 / 地点（Character / Location profile）：
| key | 中文 |
|---|---|
| `name` | 名称 |
| `aliases` | 别名 |
| `summary` | 简介 |
| `initialState` | 初始状态 |
| `authorNotes` | 作者注记 |

正文块（Paragraph）：
| key | 中文 |
|---|---|
| `storyUnitId` | 所属故事单元 |
| `text` | 正文内容 |

卷 / 章（Volume / Chapter）：
| key | 中文 |
|---|---|
| `title` | 标题 |
| `volumeId` | 所属卷 |
| `paragraphIds` | 正文块 ID |

大纲单元（Outline story unit）：
| key | 中文 |
|---|---|
| `intent` | 意图 |
| `synopsis` | 大纲提要 |
| `scope` | 范围 |
| `planningStatus` | 规划状态 |
| `realizationStatus` | 实现状态 |
| `parentId` | 上级单元 |
| `blockState` | 阻塞状态 |
| `abandonment` | 废弃信息 |
| `leaf` | 叶子计划 |

blockState 子字段：
| key | 中文 |
|---|---|
| `reasonCode` | 阻塞原因 |
| `dependencyIds` | 依赖单元 |
| `blockedAt` | 阻塞时间 |

abandonment 子字段：
| key | 中文 |
|---|---|
| `replacementStoryUnitId` | 替代单元 |
| `abandonedAt` | 废弃时间 |

leaf 子字段：
| key | 中文 |
|---|---|
| `settingMode` | 场景模式 |
| `time` | 时间设定 |
| `characters` | 角色 |
| `locations` | 地点 |
| `events` | 事件 |
| `rhythmBeats` | 节奏节拍 |
| `entityChanges` | 实体变化 |

参与绑定 / 事件 / 节奏 / 实体变化子字段：
| key | 中文 |
|---|---|
| `characterId` | 角色 |
| `locationId` | 地点 |
| `involvement` | 参与度 |
| `presence` | 出场 |
| `roles` | 作用 |
| `affected` | 受影响 |
| `rhythm` | 节奏 |
| `intensity` | 强度 |
| `readerEmotion` | 读者情绪 |
| `pointOfViewEmotion` | 视角情绪 |
| `relatedEventIds` | 关联事件 |
| `entityType` | 实体类型 |
| `entityId` | 实体 |
| `relatedEntityId` | 关联实体 |
| `category` | 类别 |
| `sourceEventIds` | 来源事件 |
| `timelineOrderKey` | 时间线顺序 |

删除 / 创作模式：
| key | 中文 |
|---|---|
| `cascade` | 级联删除 |
| `purpose` | 目的 |

未在表中的 key 回退显示原 key 名（`paramKeyLabel(key) ?? key`）。

### PARAM_VALUE_LABEL 表（字段 → 枚举值 → 中文）

| 字段 | 值 → 中文 |
|---|---|
| `planningStatus` | `idea→点子`, `outlined→已列大纲`, `ready→就绪` |
| `realizationStatus` | `pending→未开始`, `in-progress→进行中`, `completed→已完成`, `abandoned→已废弃` |
| `scope` | `saga→系列`, `arc→篇章`, `sequence→段落`, `scene→场景`, `custom→自定义` |
| `settingMode` | `located→定点场景`, `location-independent→非定点场景` |
| 阻塞 `reasonCode` | `dependency→依赖阻塞`, `decision-required→需决策`, `continuity-conflict→连续性冲突`, `missing-material→缺少素材`, `outline-incomplete→大纲不完整`, `other→其他` |
| 废弃 `reasonCode` | `story-direction-changed→剧情方向变更`, `replaced→被替代`, `merged→已合并`, `duplicate→重复`, `scope-reduced→范围缩减`, `other→其他` |
| `rhythm` | `setup→铺垫`, `rise→上升`, `hold→保持`, `turn→转折`, `climax→高潮`, `fall→下落`, `release→释放`, `aftermath→余波` |
| `presence` | `present→在场`, `offstage→幕后`, `mentioned→提及` |
| `roles` | `point-of-view→视角`, `participant→参与者`, `observer→旁观者`, `affected→受影响` |
| 地点 `role` | `primary→主要`, `secondary→次要`, `mentioned→提及` |
| `entityType` | `character→角色`, `location→地点` |
| `category` | `identity→身份`, `condition→状态`, `location→地点`, `relationship→关系`, `knowledge→认知`, `goal→目标`, `ownership→归属`, `environment→环境`, `custom→自定义` |
| `cascade` | 布尔走是/否，不在此表 |

`reasonCode` 的 `dependency`/`other` 等值在 blockState 与 abandonment 语境复用同一表；
同一值映射冲突时以字段为 key 拆开（如 block `reasonCode` 与 abandon `reasonCode` 值域不同，
按字段分别建映射，见实现时注意）。

未知枚举值回退原文。

### TOOL_NAME_LABEL 表（工具名 → 中文）

| 工具名 | 中文 |
|---|---|
| `NovelOutlineWrite` | 大纲写入 |
| `NovelOutlineEdit` | 大纲编辑 |
| `NovelCharacterWrite` | 角色写入 |
| `NovelCharacterEdit` | 角色编辑 |
| `NovelLocationWrite` | 地点写入 |
| `NovelLocationEdit` | 地点编辑 |
| `NovelParagraphWrite` | 正文写入 |
| `NovelParagraphEdit` | 正文编辑 |
| `NovelVolumeWrite` | 卷写入 |
| `NovelVolumeEdit` | 卷编辑 |
| `NovelChapterWrite` | 章节写入 |
| `NovelChapterEdit` | 章节编辑 |
| `NovelDelete` | 删除 |
| `EnterComposeMode` | 进入创作模式 |
| `ExitComposeMode` | 退出创作模式 |

未在表中的工具名回退原英文名。该表导出供详情头部与目录 meta 复用。

## 改动 3：ApprovalPanel 接入

`ApprovalPanel.tsx` 详情区：

- 保留 `identity`（会话名 · 工具中文名）、`title`、状态 pill。
- 参数区标题「完整参数」→「审批参数」（对齐原型语义：仅参数，无 diff）。
- 每个 `argumentGroups` 项渲染为：
  - `.argsTool` 工具中文名（`toolNameLabel(toolName)`）。
  - `<ParameterView value={arguments} />`（替换原 `.argsBody` `<pre>`）。
- 保留「执行结果」区（`styles.diffSec` + 原逻辑不变）。
- 保留状态行、批准 / 拒绝操作。
- 兜底：`argumentGroups.length === 0` 时展示原「旧版本审批 · 无参数详情」提示（`emptyDetail`）。
  原 `(operations?.length ?? 0) === 0 && (argumentGroups?.length ?? 0) === 0` 条件简化为
  仅判断参数为空，因为 operations 不再在详情展示。

目录区 meta（`toolNames.join(" · ")`）改为工具中文名列表（`toolNames.map(toolNameLabel).join(" · ")`）。

## 改动 4：CSS

`ApprovalPanel.module.css`：

- 新增 `.paramsGrid`（或直接复用现有 `.args` 容器）：`display: flex; flex-direction: column; gap: 2px;`
- `.paramRow`：`display: flex; gap: 10px; align-items: baseline; font-size: 12px; line-height: 1.6;`
- `.paramTag`：`flex: none; width: 92px; font-size: 10.5px; color: var(--color-faint);`（对齐原型 `.tag`）
- `.paramVal`：`flex: 1; min-width: 0; color: var(--color-fg); overflow-wrap: anywhere;`
- `.paramSub`（子区块标题）：`font-size: 11px; font-weight: 800; color: var(--color-accent-ink); margin-top: 8px;`
- `.paramItem`（「第 N 项」子区块）：嵌套缩进（`padding-left: 10px; border-left: 1px solid var(--color-border);`）
- 长文截断 `.clamp`：`display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;` +
  「展开全文」按钮。
- 删除/替换原 `.argsBody` 原始 JSON 样式（保留 `.argsTool` 样式给工具中文名）。
- diff 区样式 `.diffSec/.diffTitle/.diffCount/.diffPlaceholder` 保留（「执行结果」仍在用）。

## 改动 5：检查与验证

- `pnpm --filter @novel/ui check`（tsc --noEmit + eslint）。
- `pnpm --filter @novel/ui build`。
- GUI 手测：触发一次审批（角色/大纲/正文写入）→ 打开右侧审批面板 → 确认：
  参数为中文标签行、嵌套递归展示、无三个 diff 区、执行结果保留、工具名为中文。
- 不重跑 core smoke（前端改动，core 未变）。

## 不做的事（YAGNI）

- 不改 `ApprovalCard`（消息流卡）。
- 不改 core 投影 / 事件结构。
- 不做参数 diff（before→after）——core 目前只提供操作摘要，原型中的 old→new 对比不在此实现。
- 不处理 `ExitComposeMode` 的参数（其入参为空对象，详情以设计草稿卡呈现，保持不变）。
