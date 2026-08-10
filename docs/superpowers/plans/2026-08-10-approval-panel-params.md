# 审批面板参数展示重做 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把审批面板详情区的参数从原始 JSON 改为对齐原型的递归中文标签行，移除大纲/正文/实体 diff 区。

**Architecture:** 新增独立 `paramLabels.ts`（key/枚举值/工具名中文映射表 + 查询函数）与 `ParameterView` 递归渲染组件，`ApprovalPanel` 详情区接入并删除三个 diff 区。纯前端 `ui` 包改动，core 不动，不重跑 smoke。

**Tech Stack:** React 19 + TypeScript + CSS Modules + vitest/testing-library（jsdom）。

**Spec:** `docs/superpowers/specs/2026-08-10-approval-panel-params-design.md`（映射表全量见 spec「改动 2」，本计划为可执行实现）。

## Global Constraints

- 只改前端 `ui` 包：`src/domains/approval/**` 与 `tests/domains/approval/**`。不改 core，不重跑 smoke。
- 只改右侧审批面板 `ApprovalPanel`，不动 `ApprovalCard`。
- 关键类/导出方法须中英双语注释（中文在前，英文同行）。
- 未知 key / 枚举值 / 工具名一律回退原文。
- 每次任务结束跑 `pnpm --filter @novel/ui check`（tsc --noEmit，tests 不参与 tsc）与 `pnpm --filter @novel/ui test`（vitest，tests 目录），并提交一个聚焦 commit。

---

### Task 1: 中文映射表 `paramLabels.ts`

**Files:**
- Create: `ui/src/domains/approval/paramLabels.ts`
- Test: `ui/tests/domains/approval/paramLabels.test.ts`

**Interfaces:**
- Consumes: 无（`@novel/core` 无依赖，纯静态表）。
- Produces:
  - `PARAM_KEY_LABEL: Readonly<Record<string, string>>`
  - `PARAM_VALUE_LABEL: Readonly<Record<string, Readonly<Record<string, string>>>>`
  - `TOOL_NAME_LABEL: Readonly<Record<string, string>>`
  - `paramKeyLabel(key: string): string | undefined`
  - `paramValueLabel(field: string, value: string): string | undefined`
  - `toolNameLabel(name: string): string`
  - 供 Task 2 的 `ParameterView` 与 Task 3 的 `ApprovalPanel` 复用。

- [ ] **Step 1: 写失败测试**

`ui/tests/domains/approval/paramLabels.test.ts`:

```ts
/**
 * paramLabels 单测：key / 枚举值 / 工具名中文映射与原文回退。
 */
import { describe, expect, it } from "vitest";
import {
  paramKeyLabel,
  paramValueLabel,
  toolNameLabel,
} from "../../../src/domains/approval/paramLabels.js";

describe("paramLabels", () => {
  it("translates known keys and falls back to raw key", () => {
    expect(paramKeyLabel("baseRevision")).toBe("基础修订版本");
    expect(paramKeyLabel("authorNotes")).toBe("作者注记");
    expect(paramKeyLabel("not-a-key")).toBeUndefined();
  });

  it("translates enum values per field and falls back to raw", () => {
    expect(paramValueLabel("planningStatus", "idea")).toBe("点子");
    expect(paramValueLabel("realizationStatus", "in-progress")).toBe("进行中");
    expect(paramValueLabel("rhythm", "climax")).toBe("高潮");
    expect(paramValueLabel("category", "relationship")).toBe("关系");
    expect(paramValueLabel("planningStatus", "unknown-value")).toBeUndefined();
    expect(paramValueLabel("unknown-field", "idea")).toBeUndefined();
  });

  it("translates tool names and falls back to raw", () => {
    expect(toolNameLabel("NovelCharacterWrite")).toBe("角色写入");
    expect(toolNameLabel("NovelDelete")).toBe("删除");
    expect(toolNameLabel("UnknownTool")).toBe("UnknownTool");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @novel/ui test -- paramLabels`
Expected: FAIL，`Cannot find module` paramLabels.js。

- [ ] **Step 3: 实现 paramLabels.ts**

`ui/src/domains/approval/paramLabels.ts`:

```ts
/**
 * 审批参数中文标签表（key → 中文、枚举值 → 中文、工具名 → 中文）。
 * 未知 key / 枚举值 / 工具名一律回退原文。
 *
 * Chinese label tables for approval parameters: key labels, enum value
 * labels, and tool-name labels. Unknown keys / enum values / tool names
 * always fall back to the raw text.
 *
 * 注：blockState.reasonCode 与 abandonment.reasonCode 值域互不重叠（仅
 * "other" 共用），故合并为同一个 reasonCode 表，无需上下文消歧。
 */
export const PARAM_KEY_LABEL: Readonly<Record<string, string>> = {
  baseRevision: "基础修订版本",
  values: "变更项",
  value: "变更值",
  id: "ID",
  kind: "类型",
  orderKey: "顺序",
  description: "描述",
  note: "备注",
  name: "名称",
  aliases: "别名",
  summary: "简介",
  initialState: "初始状态",
  authorNotes: "作者注记",
  storyUnitId: "所属故事单元",
  text: "正文内容",
  title: "标题",
  volumeId: "所属卷",
  paragraphIds: "正文块 ID",
  intent: "意图",
  synopsis: "大纲提要",
  scope: "范围",
  planningStatus: "规划状态",
  realizationStatus: "实现状态",
  parentId: "上级单元",
  blockState: "阻塞状态",
  abandonment: "废弃信息",
  leaf: "叶子计划",
  reasonCode: "阻塞原因",
  dependencyIds: "依赖单元",
  blockedAt: "阻塞时间",
  replacementStoryUnitId: "替代单元",
  abandonedAt: "废弃时间",
  settingMode: "场景模式",
  time: "时间设定",
  characters: "角色",
  locations: "地点",
  events: "事件",
  rhythmBeats: "节奏节拍",
  entityChanges: "实体变化",
  characterId: "角色",
  locationId: "地点",
  involvement: "参与度",
  presence: "出场",
  roles: "作用",
  affected: "受影响",
  rhythm: "节奏",
  intensity: "强度",
  readerEmotion: "读者情绪",
  pointOfViewEmotion: "视角情绪",
  relatedEventIds: "关联事件",
  entityType: "实体类型",
  entityId: "实体",
  relatedEntityId: "关联实体",
  category: "类别",
  sourceEventIds: "来源事件",
  timelineOrderKey: "时间线顺序",
  cascade: "级联删除",
  purpose: "目的",
};

export const PARAM_VALUE_LABEL: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  planningStatus: { idea: "点子", outlined: "已列大纲", ready: "就绪" },
  realizationStatus: {
    pending: "未开始",
    "in-progress": "进行中",
    completed: "已完成",
    abandoned: "已废弃",
  },
  scope: { saga: "系列", arc: "篇章", sequence: "段落", scene: "场景", custom: "自定义" },
  settingMode: { located: "定点场景", "location-independent": "非定点场景" },
  reasonCode: {
    dependency: "依赖阻塞",
    "decision-required": "需决策",
    "continuity-conflict": "连续性冲突",
    "missing-material": "缺少素材",
    "outline-incomplete": "大纲不完整",
    "story-direction-changed": "剧情方向变更",
    replaced: "被替代",
    merged: "已合并",
    duplicate: "重复",
    "scope-reduced": "范围缩减",
    other: "其他",
  },
  rhythm: {
    setup: "铺垫",
    rise: "上升",
    hold: "保持",
    turn: "转折",
    climax: "高潮",
    fall: "下落",
    release: "释放",
    aftermath: "余波",
  },
  presence: { present: "在场", offstage: "幕后", mentioned: "提及" },
  roles: { "point-of-view": "视角", participant: "参与者", observer: "旁观者", affected: "受影响" },
  locationRole: { primary: "主要", secondary: "次要", mentioned: "提及" },
  entityType: { character: "角色", location: "地点" },
  category: {
    identity: "身份",
    condition: "状态",
    location: "地点",
    relationship: "关系",
    knowledge: "认知",
    goal: "目标",
    ownership: "归属",
    environment: "环境",
    custom: "自定义",
  },
};

export const TOOL_NAME_LABEL: Readonly<Record<string, string>> = {
  NovelOutlineWrite: "大纲写入",
  NovelOutlineEdit: "大纲编辑",
  NovelCharacterWrite: "角色写入",
  NovelCharacterEdit: "角色编辑",
  NovelLocationWrite: "地点写入",
  NovelLocationEdit: "地点编辑",
  NovelParagraphWrite: "正文写入",
  NovelParagraphEdit: "正文编辑",
  NovelVolumeWrite: "卷写入",
  NovelVolumeEdit: "卷编辑",
  NovelChapterWrite: "章节写入",
  NovelChapterEdit: "章节编辑",
  NovelDelete: "删除",
  EnterComposeMode: "进入创作模式",
  ExitComposeMode: "退出创作模式",
};

export function paramKeyLabel(key: string): string | undefined {
  return PARAM_KEY_LABEL[key];
}

export function paramValueLabel(field: string, value: string): string | undefined {
  return PARAM_VALUE_LABEL[field]?.[value];
}

export function toolNameLabel(name: string): string {
  return TOOL_NAME_LABEL[name] ?? name;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @novel/ui test -- paramLabels`
Expected: PASS（3 个用例）。

- [ ] **Step 5: Commit**

```bash
git add ui/src/domains/approval/paramLabels.ts ui/tests/domains/approval/paramLabels.test.ts
git commit -m "feat(ui): 审批参数中文映射表 paramLabels"
```

---

### Task 2: 递归参数渲染组件 `ParameterView`

**Files:**
- Create: `ui/src/domains/approval/components/ParameterView.tsx`
- Create: `ui/src/domains/approval/components/ParameterView.module.css`
- Test: `ui/tests/domains/approval/components/ParameterView.test.tsx`

**Interfaces:**
- Consumes: `paramKeyLabel(field)`、`paramValueLabel(field, value)`（Task 1）。
- Produces:
  - `ParameterView({ value }: { readonly value: JsonValue }): JSX.Element`
  - 供 Task 3 的 `ApprovalPanel` 详情区使用。

- [ ] **Step 1: 写失败测试**

`ui/tests/domains/approval/components/ParameterView.test.tsx`:

```tsx
/**
 * ParameterView 单测：中文标签行、嵌套递归、数组连接、枚举翻译、长文展开。
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ParameterView } from "../../../../src/domains/approval/components/ParameterView.js";

describe("ParameterView", () => {
  it("renders top-level keys as Chinese-labelled rows", () => {
    render(<ParameterView value={{ baseRevision: "rev-1", name: "林夏", authorNotes: "作者注记内容" }} />);
    expect(screen.getByText("基础修订版本")).toBeInTheDocument();
    expect(screen.getByText("rev-1")).toBeInTheDocument();
    expect(screen.getByText("名称")).toBeInTheDocument();
    expect(screen.getByText("林夏")).toBeInTheDocument();
  });

  it("renders values object array as 第 N 项 sub-blocks", () => {
    render(
      <ParameterView
        value={{
          baseRevision: "rev-1",
          values: [
            { id: "C-1", name: "林夏", aliases: ["夏", "夏夏"] },
            { id: "C-2", name: "顾一舟" },
          ],
        }}
      />,
    );
    expect(screen.getByText("变更项")).toBeInTheDocument();
    expect(screen.getByText("第 1 项")).toBeInTheDocument();
    expect(screen.getByText("第 2 项")).toBeInTheDocument();
    expect(screen.getAllByText("林夏").length).toBeGreaterThan(0);
  });

  it("joins primitive arrays with 、", () => {
    render(<ParameterView value={{ roles: ["point-of-view", "participant"] }} />);
    expect(screen.getByText("视角、参与者")).toBeInTheDocument();
  });

  it("renders null as 空 and booleans as 是/否", () => {
    render(<ParameterView value={{ cascade: true, note: null }} />);
    expect(screen.getByText("是")).toBeInTheDocument();
    expect(screen.getByText("空")).toBeInTheDocument();
  });

  it("translates enum values", () => {
    render(<ParameterView value={{ planningStatus: "idea", scope: "scene" }} />);
    expect(screen.getByText("点子")).toBeInTheDocument();
    expect(screen.getByText("场景")).toBeInTheDocument();
  });

  it("shows expand toggle for long text and none for short", () => {
    const { rerender } = render(<ParameterView value={{ summary: "短" }} />);
    expect(screen.queryByText("展开全文")).not.toBeInTheDocument();
    rerender(<ParameterView value={{ summary: "长".repeat(200) }} />);
    expect(screen.getByText("展开全文")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @novel/ui test -- ParameterView`
Expected: FAIL，`Cannot find module` ParameterView.js。

- [ ] **Step 3: 实现 ParameterView.tsx 与 module.css**

`ui/src/domains/approval/components/ParameterView.tsx`:

```tsx
/**
 * ParameterView
 *
 * 审批参数递归渲染（对齐原型 .params 网格）：对象逐字段「中文标签 + 值」，
 * 嵌套对象 / 对象数组递归为子区块，基本值数组顿号连接，null 显示「空」，
 * 已知枚举值翻译为中文。长文本默认 4 行截断，可「展开全文」。
 *
 * Recursively renders tool arguments as Chinese-labelled rows matching the
 * prototype .params grid; nested objects and object arrays recurse into
 * sub-blocks; primitive arrays join with 、; known enum values are translated.
 * Long text is clamped to 4 lines with an expand toggle.
 */
import { useState, type JSX } from "react";
import type { JsonObject, JsonValue } from "@novel/core";
import { paramKeyLabel, paramValueLabel } from "../paramLabels.js";
import styles from "./ParameterView.module.css";

const LONG_TEXT_CHARS = 120;

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPrimitive(value: JsonValue): boolean {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function primitiveText(
  value: string | number | boolean | null,
  field?: string,
): string {
  if (value === null) return "空";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "string") return paramValueLabel(field ?? "", value) ?? value;
  return String(value);
}

/** 长文本 4 行截断 + 展开全文。Clamped long text with expand toggle. */
function LongText({ text }: { readonly text: string }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  if (text.length <= LONG_TEXT_CHARS) {
    return <span className={styles.paramVal}>{text}</span>;
  }
  return (
    <span className={styles.paramValWrap}>
      <span
        className={[
          styles.paramVal,
          styles.clamp,
          expanded ? styles.expanded : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {text}
      </span>
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? "收起" : "展开全文"}
      </button>
    </span>
  );
}

/** 单个字段：基本值渲染为行，嵌套对象/数组渲染为子区块。 */
function FieldRow({
  field,
  value,
}: {
  readonly field: string;
  readonly value: JsonValue;
}): JSX.Element {
  const label = paramKeyLabel(field) ?? field;
  if (typeof value === "string") {
    return (
      <div className={styles.paramRow}>
        <span className={styles.paramTag}>{label}</span>
        <LongText text={primitiveText(value, field)} />
      </div>
    );
  }
  if (isPrimitive(value)) {
    return (
      <div className={styles.paramRow}>
        <span className={styles.paramTag}>{label}</span>
        <span className={styles.paramVal}>{primitiveText(value)}</span>
      </div>
    );
  }
  return (
    <div className={styles.paramSubBlock}>
      <div className={styles.paramSub}>{label}</div>
      <ParamFields value={value} field={field} />
    </div>
  );
}

/** 对象逐字段渲染。Renders each object field as a row or sub-block. */
function ParamObject({ obj }: { readonly obj: JsonObject }): JSX.Element {
  return (
    <div className={styles.params}>
      {Object.entries(obj).map(([field, fieldValue]) => (
        <FieldRow key={field} field={field} value={fieldValue} />
      ))}
    </div>
  );
}

/** 数组或对象的递归容器：基本值数组顿号连接，对象数组逐项子区块。 */
function ParamFields({
  value,
  field,
}: {
  readonly value: JsonObject | JsonValue[];
  readonly field?: string;
}): JSX.Element {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <div className={styles.paramRow}>
          <span className={styles.paramVal}>空</span>
        </div>
      );
    }
    if (value.every(isPrimitive)) {
      return (
        <div className={styles.paramRow}>
          <span className={styles.paramVal}>
            {value.map((item) => primitiveText(item, field)).join("、")}
          </span>
        </div>
      );
    }
    return (
      <div className={styles.paramItems}>
        {value.map((item, index) => (
          <div key={index} className={styles.paramItem}>
            <div className={styles.paramItemHead}>第 {index + 1} 项</div>
            {isJsonObject(item) ? (
              <ParamObject obj={item} />
            ) : (
              <div className={styles.paramVal}>{primitiveText(item, field)}</div>
            )}
          </div>
        ))}
      </div>
    );
  }
  return <ParamObject obj={value} />;
}

export interface ParameterViewProps {
  /** 待渲染的工具参数（JsonValue）。Tool arguments to render. */
  readonly value: JsonValue;
}

export function ParameterView({ value }: ParameterViewProps): JSX.Element {
  if (isJsonObject(value) || Array.isArray(value)) {
    return <ParamFields value={value} />;
  }
  return (
    <div className={styles.paramRow}>
      <span className={styles.paramVal}>{primitiveText(value)}</span>
    </div>
  );
}
```

`ui/src/domains/approval/components/ParameterView.module.css`:

```css
/**
 * ParameterView 视觉（对齐原型 .params 网格：行式标签 + 值）。
 * Matches the prototype .params grid: label + value rows.
 */
.params {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.paramRow {
  display: flex;
  gap: 10px;
  align-items: baseline;
  font-size: 12px;
  line-height: 1.6;
}

.paramTag {
  flex: none;
  width: 92px;
  font-size: 10.5px;
  color: var(--color-faint);
}

.paramVal {
  flex: 1;
  min-width: 0;
  color: var(--color-fg);
  overflow-wrap: anywhere;
  word-break: break-word;
}

.paramValWrap {
  flex: 1;
  min-width: 0;
  display: inline-flex;
  flex-direction: column;
  gap: 2px;
}

.clamp {
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.clamp.expanded {
  display: block;
  -webkit-line-clamp: unset;
}

.toggle {
  align-self: flex-start;
  border: 0;
  background: none;
  padding: 0;
  font-size: 11px;
  font-weight: 700;
  color: var(--color-accent-ink);
  cursor: pointer;
}

.paramSubBlock {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.paramSub {
  margin-top: 6px;
  font-size: 11px;
  font-weight: 800;
  color: var(--color-accent-ink);
}

.paramItems {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.paramItem {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-left: 10px;
  border-left: 1px solid var(--color-border);
}

.paramItemHead {
  font-size: 10.5px;
  font-weight: 800;
  color: var(--color-muted);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @novel/ui test -- ParameterView`
Expected: PASS（6 个用例）。

- [ ] **Step 5: Commit**

```bash
git add ui/src/domains/approval/components/ParameterView.tsx ui/src/domains/approval/components/ParameterView.module.css ui/tests/domains/approval/components/ParameterView.test.tsx
git commit -m "feat(ui): 审批参数递归中文渲染组件 ParameterView"
```

---

### Task 3: ApprovalPanel 接入并移除 diff 区

**Files:**
- Modify: `ui/src/domains/approval/components/ApprovalPanel.tsx`
- Modify: `ui/src/domains/approval/components/ApprovalPanel.module.css`
- Test: `ui/tests/domains/approval/components/ApprovalPanel.test.tsx`

**Interfaces:**
- Consumes: `ParameterView`（Task 2）、`toolNameLabel`（Task 1）。
- Produces: `ApprovalPanel` 详情区不再渲染大纲/正文/实体变更，参数以中文标签行呈现，工具名中文化。

- [ ] **Step 1: 写失败测试**

`ui/tests/domains/approval/components/ApprovalPanel.test.tsx`:

```tsx
/**
 * ApprovalPanel 单测：详情区展示中文参数行、无 diff 区、工具名中文化。
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ApprovalStore } from "../../../../src/domains/approval/ApprovalStore.js";
import { ApprovalPanel } from "../../../../src/domains/approval/components/ApprovalPanel.js";

const DIGEST = "sha256:0000000000000000000000000000000000000000000000000000000000000000";

function makeStore(): ApprovalStore {
  const store = new ApprovalStore();
  store.setApprovals([
    {
      conversationId: "C-1",
      conversationStatus: "active",
      approvalRequestId: "AR-1",
      turnId: "T-1",
      toolName: "NovelCharacterWrite",
      title: "新增角色：林夏",
      argumentDigest: DIGEST,
      status: "pending",
      requestedAt: "2026-08-05T09:00:00.000Z",
      arguments: { baseRevision: "rev-1", values: [{ id: "C-1", name: "林夏" }] },
    },
  ]);
  return store;
}

describe("ApprovalPanel", () => {
  it("shows Chinese params and no diff sections", () => {
    render(<ApprovalPanel store={makeStore()} />);
    expect(screen.getAllByText("角色写入").length).toBeGreaterThan(0);
    expect(screen.getByText("审批参数")).toBeInTheDocument();
    expect(screen.getByText("基础修订版本")).toBeInTheDocument();
    expect(screen.queryByText("大纲变更")).not.toBeInTheDocument();
    expect(screen.queryByText("正文变更")).not.toBeInTheDocument();
    expect(screen.queryByText("实体变更")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @novel/ui test -- ApprovalPanel`
Expected: FAIL（当前详情仍渲染「大纲变更」等 diff 区，`queryByText("大纲变更")` 命中）。

- [ ] **Step 3: 修改 ApprovalPanel.tsx**

`ui/src/domains/approval/components/ApprovalPanel.tsx` 具体改动：

1. 顶部 import 区新增：
```ts
import { toolNameLabel } from "../paramLabels.js";
import { ParameterView } from "./ParameterView.js";
```
2. 删除以下常量与函数（仅被 diff 区使用）：
   `OP_SYMBOL`、`OP_LABEL`、`KIND_LABEL`、`OP_KIND_LABEL`、`opClass()`、`OperationRow` 接口、`DiffSection` 组件。
3. 删除 `const operations = ...`（含 `selectedGroup?.approvals.flatMap(...)`）及其下方的
   `outlineOps / manuscriptOps / entityOps` 三个过滤。
4. 详情参数区（原 `.argsBody` `<pre>` 段）替换为：
```tsx
{argumentGroups !== undefined && argumentGroups.length > 0 ? (
  <div className={styles.args}>
    <span className={styles.argsTitle}>审批参数</span>
    {argumentGroups.map((group, index) => (
      <div key={`${group.toolName}-${index}`} className={styles.argsGroup}>
        <span className={styles.argsTool}>{toolNameLabel(group.toolName)}</span>
        <ParameterView value={group.arguments} />
      </div>
    ))}
  </div>
) : null}
```
5. 删除三个 `DiffSection` 调用：
   `大纲变更`、`正文变更`、`实体变更`。
6. 「执行结果」区保留不变。
7. `emptyDetail` 条件由
   `(operations?.length ?? 0) === 0 && (argumentGroups?.length ?? 0) === 0`
   简化为 `(argumentGroups?.length ?? 0) === 0`。
8. 目录 meta 工具名中文化：
   `{toolNames.join(" · ")}` → `{toolNames.map(toolNameLabel).join(" · ")}`。
9. 详情 identity 工具名中文化：
   `selectedGroup.approvals.map((approval) => approval.toolName).join(" · ")`
   → `selectedGroup.approvals.map((approval) => toolNameLabel(approval.toolName)).join(" · ")`。

`ui/src/domains/approval/components/ApprovalPanel.module.css` 具体改动：
- 删除仅被 diff 区使用的 `.ops / .op / .opMark / .opText / .opKind` 及 `.add .opMark / .mod .opMark / .del .opMark` 规则。
- 删除旧原始 JSON 样式 `.argsBody`（`.args / .argsGroup / .argsTool / .argsTitle` 保留）。
- `.diffSec / .diffTitle / .diffCount / .diffPlaceholder` 保留（「执行结果」区仍用）。

- [ ] **Step 4: 运行测试与 check 确认通过**

Run: `pnpm --filter @novel/ui test -- ApprovalPanel`
Expected: PASS。

Run: `pnpm --filter @novel/ui check`
Expected: tsc --noEmit 无错误、eslint 无错误（eslint 规则 `no-unused-vars` 会捕获残留未用常量）。

- [ ] **Step 5: Commit**

```bash
git add ui/src/domains/approval/components/ApprovalPanel.tsx ui/src/domains/approval/components/ApprovalPanel.module.css ui/tests/domains/approval/components/ApprovalPanel.test.tsx
git commit -m "feat(ui): 审批面板移除 diff 区并接入中文参数展示"
```

---

### Task 4: 端到端验证与收尾

- [ ] **Step 1: 全量 ui 测试 + check**

Run: `pnpm --filter @novel/ui test`
Expected: 全部 PASS。

Run: `pnpm --filter @novel/ui check`
Expected: 无错误。

- [ ] **Step 2: 构建并 GUI 手测**

Run: `pnpm --filter @novel/ui build && pnpm --dir gui build`
Expected: 构建成功。

重启 GUI（`pnpm --dir gui start`，先停掉当前后台任务 `blhaxwsd3`）。触发一次角色/大纲/正文写入审批 →
打开右侧审批面板 → 人工确认：参数为中文标签行、嵌套递归、无大纲/正文/实体变更 diff、执行结果保留、工具名为中文。

- [ ] **Step 3: Commit 收尾（如有构建后残留）**

构建产物被 gitignore，通常无需提交。确认 `git status` 干净后结束。

## Self-Review 记录

- **Spec coverage:** 改动 1（移除 diff）→ Task 3；改动 2（ParameterView + 三张表）→ Task 1、2；
  改动 3（ApprovalPanel 接入 + 工具名中文化）→ Task 3；改动 4（CSS）→ Task 2、3；
  改动 5（验证）→ Task 4。无遗漏。
- **Placeholder scan:** 各步骤均含完整代码与命令，无 TBD/TODO。
- **Type consistency:** `paramKeyLabel/paramValueLabel/toolNameLabel` 签名在 Task 1 定义，
  Task 2/3 使用一致；`ParameterViewProps.value: JsonValue` 与 ApprovalPanel 传入
  `group.arguments`（`GlobalApprovalProjection["arguments"]` = `JsonValue`）一致。
- **实现细化（相对 spec）：** 合并 `reasonCode` 单表（block/abandon 值域不重叠）；`roles`、
  `presence` 等枚举数组经 `primitiveText(item, field)` 逐项翻译后顿号连接。
