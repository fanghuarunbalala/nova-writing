#!/usr/bin/env node
/**
 * 样式 token 化批量替换（M2 一次性工具，dry-run 默认）。
 *
 * 原则：绝对像素一致——只做"等值替换"（字面量 → 同值 token），不归一化。
 * 作用于 src/**\/*.module.css（theme 全局 css 豁免），按属性上下文替换，
 * 不做全局字符串替换。`--apply` 实写；否则只打印将要发生的 diff 与统计。
 *
 * 用法：node scripts/apply-token-map.mjs [--apply]
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "src");
const apply = process.argv.includes("--apply");

/* ---------- 映射表（值 → token 名；全部为精确值快照） ---------- */

/** 间距族属性：非刻度 px 快照 + 4px 刻度语义 token */
const SPACE_MAP = {
  "1.5": "--space-1-5px", "2": "--space-2px", "2.8": "--space-2-8px",
  "3": "--space-3px", "3.4": "--space-3-4px", "4": "--space-1",
  "5": "--space-5px", "5.5": "--space-5-5px", "6": "--space-6px",
  "6.5": "--space-6-5px", "7": "--space-7px", "8": "--space-2",
  "9": "--space-9px", "10": "--space-10px", "11": "--space-11px",
  "12": "--space-3", "13": "--space-13px", "14": "--space-14px",
  "15": "--space-15px", "16": "--space-4", "17": "--space-17px",
  "18": "--space-18px", "20": "--space-5", "22": "--space-22px",
  "24": "--space-6", "26": "--space-26px", "28": "--space-28px",
  "29": "--space-29px",
  "30": "--space-30px", "32": "--space-8", "34": "--space-34px",
  "38": "--space-38px", "40": "--space-10", "48": "--space-12",
  "56": "--space-56px", "64": "--space-16", "132": "--space-132px",
};

/** 字号 */
const FS_MAP = {
  "9": "--fs-9", "9.5": "--fs-9-5", "10": "--fs-10", "10.5": "--fs-xs",
  "11": "--fs-11", "11.5": "--fs-meta", "12": "--fs-12", "12.5": "--fs-12-5",
  "13": "--fs-13", "13.5": "--fs-13-5", "14": "--fs-h2", "14.5": "--fs-14-5",
  "15": "--fs-body", "16": "--fs-h1", "16.5": "--fs-16-5", "19": "--fs-display",
  "22": "--fs-22", "30": "--fs-30",
};

/** 字重（纯数字声明必须 token 化） */
const FW_MAP = {
  "400": "--fw-regular", "500": "--fw-500", "550": "--fw-medium",
  "600": "--fw-600", "650": "--fw-semibold", "700": "--fw-bold",
  "750": "--fw-750", "800": "--fw-heavy",
};

/** 圆角（1px 为规则 d 允许的字面量，不映射） */
const RADIUS_MAP = {
  "2": "--radius-2px", "4": "--radius-4px", "5": "--radius-xs",
  "6": "--radius-sm", "8": "--radius-8px", "9": "--radius-md",
  "10": "--radius-10px", "12": "--radius-12px", "14": "--radius-lg",
  "16": "--radius-16px", "999": "--radius-pill",
};

/** z-index：按文件 + 值定位（同名不同角色不合并） */
const Z_MAP = {
  "domains/conversation/components/ConversationListItem.module.css": { 2: "--z-list-item" },
  "domains/conversation/components/ConversationItemMenu.module.css": { 3: "--z-menu-item" },
  "shell/main/ChatSurface.module.css": { 5: "--z-decor" },
  "shell/inspector/InspectorHost.module.css": { 5: "--z-drag-handle", 42: "--z-inspector" },
  "shared/primitives/DragHandle.module.css": { 5: "--z-drag-handle" },
  "domains/conversation/components/ConversationComposer.module.css": { 6: "--z-composer" },
  "shell/topbar/TopBar.module.css": { 20: "--z-topbar" },
  "domains/approval/components/ApprovalPanel.module.css": { 24: "--z-dock-scrim", 30: "--z-dock" },
  "domains/conversation/components/ComposerModeBar.module.css": { 30: "--z-mode-options" },
  "shared/primitives/Dialog.module.css": { 50: "--z-overlay", 51: "--z-dialog" },
  "shell/overlays/ToastHost.module.css": { 50: "--z-overlay" },
  "shared/primitives/Dropdown.module.css": { 60: "--z-dropdown" },
  "shared/primitives/Tooltip.module.css": { 70: "--z-tooltip" },
};

/** 组件级阴影字面量（精确字符串，允许任意缩进） */
const SHADOW_MAP = [
  ["box-shadow: 12px 0 30px rgba(20, 12, 6, 0.18)", "box-shadow: var(--shadow-panel)"],
  ["box-shadow: 0 1px 3px rgba(20, 12, 6, 0.08)", "box-shadow: var(--shadow-xs)"],
  ["box-shadow: -18px 0 50px rgba(20, 12, 6, 0.18)", "box-shadow: var(--shadow-drawer)"],
];

/** 前景色字面量（渐变底白字 / legacy 裸 hex） */
const COLOR_MAP = [
  ["color: #fff", "color: var(--color-on-accent)"],
  ["color: #e5484d", "color: var(--color-design-error)"],
];

/** 语义混合 token（两次晋升制：完全相同 (基色,%,target) 组合 ≥2 次；精确字符串替换） */
const COLOR_MIX_MAP = [
  ["color-mix(in oklab, var(--color-accent) 9%, var(--color-surface))", "var(--color-accent-9)"],
  ["color-mix(in oklab, var(--color-accent) 55%, transparent)", "var(--color-accent-55)"],
  ["color-mix(in oklab, var(--color-accent) 18%, var(--color-border-strong))", "var(--color-accent-18)"],
  ["color-mix(in oklab, var(--color-accent) 12%, var(--color-surface-2))", "var(--color-accent-12)"],
  ["color-mix(in oklab, var(--color-accent) 8%, var(--color-surface))", "var(--color-accent-8-surface)"],
  ["color-mix(in oklab, var(--color-accent) 8%, transparent)", "var(--color-accent-8-transparent)"],
  ["color-mix(in oklab, var(--color-accent) 45%, transparent)", "var(--color-accent-45)"],
  ["color-mix(in oklab, var(--color-accent) 10%, transparent)", "var(--color-accent-10)"],
  ["color-mix(in oklab, var(--color-accent) 11%, var(--color-surface))", "var(--color-accent-11)"],
  ["color-mix(in oklab, var(--color-accent) 6%, transparent)", "var(--color-accent-6)"],
  ["color-mix(in oklab, var(--color-accent) 88%, var(--color-fg))", "var(--color-accent-88)"],
  ["color-mix(in oklab, var(--color-warn) 40%, transparent)", "var(--color-warn-40)"],
  ["color-mix(in oklab, var(--color-danger) 8%, var(--color-surface))", "var(--color-danger-8)"],
  ["color-mix(in oklab, var(--color-danger) 45%, transparent)", "var(--color-danger-45)"],
  ["color-mix(in oklab, var(--color-danger) 32%, transparent)", "var(--color-danger-32)"],
  ["color-mix(in oklab, var(--color-danger) 18%, var(--color-surface))", "var(--color-danger-18)"],
  ["color-mix(in oklab, var(--color-danger) 12%, var(--color-surface))", "var(--color-danger-12-surface)"],
  ["color-mix(in oklab, var(--color-danger) 12%, transparent)", "var(--color-danger-12-transparent)"],
  ["color-mix(in oklab, var(--color-danger) 10%, transparent)", "var(--color-danger-10)"],
  ["color-mix(in oklab, var(--color-border-strong) 72%, transparent)", "var(--color-border-strong-72)"],
  ["color-mix(in oklab, var(--color-surface) 82%, transparent)", "var(--color-chrome-bg)"],
  ["color-mix(in oklab, var(--color-accent) 50%, transparent)", "var(--color-focus-ring-strong)"],
];

/* ---------- 工具 ---------- */

async function collectCss(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collectCss(full)));
    else if (entry.name.endsWith(".module.css")) files.push(full);
  }
  return files;
}

/** 从 tokens.css 解析已定义 token 名集合（校验 fallback 剥除安全性） */
async function loadTokens() {
  const content = await readFile(join(srcDir, "shared/theme/tokens.css"), "utf8");
  return new Set([...content.matchAll(/--([a-z0-9-]+):/g)].map((m) => m[1]));
}

const SPACE_PROPS_RE =
  /^\s*(padding|padding-top|padding-right|padding-bottom|padding-left|margin|margin-top|margin-right|margin-bottom|margin-left|gap|inset|top|right|bottom|left|border-top|border-right|border-bottom|border-left|border-width|border-top-width|border-right-width|border-bottom-width|border-left-width|outline-width|outline-offset)\s*:/;

/** 属性族内 px 值替换（0/0px/1px 为规则 d 允许的字面量，跳过；
 *  var(--token) 整体跳过——token 名内含数字（--space-2px）不可再匹配，保证幂等） */
function replacePx(head, map) {
  return head.replace(/var\(--[a-z0-9-]+\)|(\d+(?:\.\d+)?)px/g, (m, v) => {
    if (v === undefined) return m; // var(--token) 原样
    if (v === "0" || v === "1") return m;
    const token = map[v];
    return token ? `var(${token})` : m;
  });
}

/** animation 引用 → var(--anim-*)（CSS Modules 会对模块内 animation 引用
 *  无条件 hash 重命名，直接写名会指向不存在的 hash 名） */
const ANIM_MAP = [
  ["animation: status-sway ", "animation: var(--anim-status-sway) "],
  ["animation: grad-flow ", "animation: var(--anim-grad-flow) "],
  ["animation: conv-spin ", "animation: var(--anim-conv-spin) "],
  ["animation: conv-in ", "animation: var(--anim-conv-in) "],
  ["animation: failed-shake ", "animation: var(--anim-failed-shake) "],
  ["animation: status-breath ", "animation: var(--anim-status-breath) "],
  ["animation: status-bob ", "animation: var(--anim-status-bob) "],
  ["animation: status-drop ", "animation: var(--anim-status-drop) "],
  ["animation: block-flash ", "animation: var(--anim-block-flash) "],
  ["animation: nodePulse ", "animation: var(--anim-node-pulse) "],
  ["animation: dialog-fade ", "animation: var(--anim-dialog-fade) "],
  ["animation: dialog-in ", "animation: var(--anim-dialog-in) "],
  ["animation: dropdown-in ", "animation: var(--anim-dropdown-in) "],
  ["animation: spinner-rotate ", "animation: var(--anim-spinner-rotate) "],
  ["animation: tooltip-in ", "animation: var(--anim-tooltip-in) "],
  ["animation: toast-in ", "animation: var(--anim-toast-in) "],
];

/** 移除模块 css 内的 @keyframes 块（含嵌套花括号的帧体；规则 c 执法集中制） */
function stripKeyframes(content) {
  let out = "";
  let i = 0;
  while (i < content.length) {
    const idx = content.indexOf("@keyframes", i);
    if (idx === -1) {
      out += content.slice(i);
      break;
    }
    // 仅当 "@keyframes" 位于行首空白之后（排除注释内提及）
    const lineStart = content.lastIndexOf("\n", idx) + 1;
    let lineEnd = content.indexOf("\n", idx);
    if (lineEnd === -1) lineEnd = content.length;
    if (/^\s*@keyframes\s+[\w-]+\s*\{/.test(content.slice(lineStart, lineEnd))) {
      out += content.slice(i, idx);
      const brace = content.indexOf("{", idx);
      let depth = 0;
      let k = brace;
      for (; k < content.length; k++) {
        if (content[k] === "{") depth++;
        else if (content[k] === "}") {
          depth--;
          if (depth === 0) break;
        }
      }
      let end = k + 1;
      // 吃掉块尾到行尾（含换行）
      while (end < content.length && content[end] !== "\n") end++;
      if (content[end] === "\n") end++;
      i = end;
    } else {
      out += content.slice(i, idx + "@keyframes".length);
      i = idx + "@keyframes".length;
    }
  }
  return out;
}

/** 单行变换：返回 { head, changed }（注释尾保留不动） */
function transformLine(head, fileRel, tokens) {
  let out = head;
  let changed = false;

  // 1) 组件级阴影字面量
  for (const [from, to] of SHADOW_MAP) {
    if (out.includes(from)) {
      out = out.replace(from, to);
      changed = true;
    }
  }
  // 2) 前景色字面量
  for (const [from, to] of COLOR_MAP) {
    if (out.includes(from)) {
      out = out.replace(from, to);
      changed = true;
    }
  }
  // 2b) 语义混合 token（两次晋升制）
  for (const [from, to] of COLOR_MIX_MAP) {
    if (out.includes(from)) {
      out = out.replace(from, to);
      changed = true;
    }
  }
  // 2c) animation 引用 → var(--anim-*)（避免 CSS Modules hash 重命名）
  for (const [from, to] of ANIM_MAP) {
    if (out.includes(from)) {
      out = out.replace(from, to);
      changed = true;
    }
  }
  // 3) z-index（按文件+值）
  const zMap = Z_MAP[fileRel];
  if (zMap) {
    out = out.replace(/^(\s*z-index:\s*)(\d+)(;.*)$/, (m, pre, v, post) => {
      const token = zMap[Number(v)];
      if (!token) return m;
      changed = true;
      return `${pre}var(${token})${post}`;
    });
  }
  // 4) 死代码 fallback 剥除：var(--token, #hex|NNpx) → var(--token)（token 已定义才安全）
  out = out.replace(/var\(--([a-z0-9-]+),\s*(?:#[0-9a-fA-F]{3,8}|[0-9.]+px)\)/g, (m, name) => {
    if (!tokens.has(name)) return m; // 未定义 → fallback 是渲染值，不动
    changed = true;
    return `var(--${name})`;
  });
  // 5) 属性族 px 值 → token
  if (SPACE_PROPS_RE.test(out)) {
    const next = replacePx(out, SPACE_MAP);
    if (next !== out) { out = next; changed = true; }
  } else if (/^\s*font-size\s*:/.test(out)) {
    const next = replacePx(out, FS_MAP);
    if (next !== out) { out = next; changed = true; }
  } else if (/^\s*border-radius\s*:/.test(out)) {
    const next = replacePx(out, RADIUS_MAP);
    if (next !== out) { out = next; changed = true; }
  } else if (/^\s*font-weight\s*:/.test(out)) {
    const next = out.replace(/^(\s*font-weight:\s*)(\d+)(;.*)$/, (m, pre, v, post) => {
      const token = FW_MAP[v];
      if (!token) return m;
      return `${pre}var(${token})${post}`;
    });
    if (next !== out) { out = next; changed = true; }
  }
  return { head: out, changed };
}

/* ---------- 主流程 ---------- */

const tokens = await loadTokens();
const files = await collectCss(srcDir);
let totalChanged = 0;
const report = [];

for (const file of files) {
  const fileRel = relative(srcDir, file).replaceAll("\\", "/");
  const raw = await readFile(file, "utf8");
  const content = stripKeyframes(raw);
  if (content !== raw) {
    totalChanged += 1;
    report.push(`${fileRel}: 移除本地 @keyframes 块（集中到 shared/theme/animations.css）`);
  }
  const crlf = content.includes("\r\n"); // 工作区为 CRLF（core.autocrlf），写入时保留原行尾
  const lines = content.split(/\r?\n/);
  const next = lines.map((line) => {
    // 注释部分不动（避免替换注释里的示例值）
    const cIdx = line.indexOf("/*");
    if (cIdx === 0) return line;
    const head = cIdx >= 0 ? line.slice(0, cIdx) : line;
    const tail = cIdx >= 0 ? line.slice(cIdx) : "";
    const { head: nh, changed } = transformLine(head, fileRel, tokens);
    if (changed) {
      totalChanged += 1;
      report.push(`${fileRel}: ${line.trim()}  →  ${(nh + tail).trim()}`);
    }
    return nh + tail;
  });
  if (apply) await writeFile(file, next.join(crlf ? "\r\n" : "\n"), "utf8");
}

const action = apply ? "已写入" : "DRY-RUN（加 --apply 实写）";
console.log(`\n${action}，共 ${files.length} 个 module.css，${totalChanged} 行变更：\n`);
console.log(report.join("\n") || "（无变更）");
