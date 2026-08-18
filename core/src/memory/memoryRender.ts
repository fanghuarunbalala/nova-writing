/**
 * memory 域渲染与摘要（PRD F2/F6/F9）。
 *
 * - renderMemoryBlock：纪元注入的目录全文（<memory> 块 + 使用/防抄袭 footer +
 *   6000 字截断）。
 * - digestOf / presetDigestOf：F9 摘要基线（不落文件，nudge 状态内存）。
 * - diffIndexNames：变更通知的 ±类目名（新旧目录对比）。
 */
import { createHash } from "node:crypto";
import {
  MEMORY_DOMAINS,
  MEMORY_RENDER_MAX,
  emptyMemoryIndex,
  type MemoryDomain,
  type MemoryIndex,
} from "./memorySchema.js";

/** 文本摘要（sha256 hex 前 16 位——变更检测用，无密码学用途） */
export function digestOf(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

/** preset 目录合成摘要：全部 preset 文件（相对路径 + 内容）排序拼接后哈希 */
export function presetDigestOf(files: ReadonlyArray<{ path: string; content: string }>): string {
  const joined = files
    .map((f) => `${f.path}\n${f.content}`)
    .sort()
    .join("\n\u0000\n");
  return digestOf(joined);
}

/** 目录全部类目名（按域分组；diff 用） */
export function indexNamesOf(index: MemoryIndex): Map<MemoryDomain, Set<string>> {
  const map = new Map<MemoryDomain, Set<string>>();
  for (const domain of MEMORY_DOMAINS) {
    map.set(domain, new Set((index[domain] ?? []).map((e) => e.name)));
  }
  return map;
}

/** 新旧目录类目差异（变更通知文案；空 = 无差异） */
export function diffIndexNames(prev: MemoryIndex, next: MemoryIndex): string {
  const parts: string[] = [];
  for (const domain of MEMORY_DOMAINS) {
    const before = new Set((prev[domain] ?? []).map((e) => e.name));
    const after = new Set((next[domain] ?? []).map((e) => e.name));
    const added = [...after].filter((n) => !before.has(n));
    const removed = [...before].filter((n) => !after.has(n));
    if (added.length > 0) parts.push(`+${domain}:${added.join("、")}`);
    if (removed.length > 0) parts.push(`−${domain}:${removed.join("、")}`);
  }
  return parts.join(" ");
}

/** preset 文件名差异（变更通知文案） */
export function diffPresetFiles(
  prev: readonly string[],
  next: readonly string[],
): string {
  const before = new Set(prev);
  const after = new Set(next);
  const added = [...after].filter((f) => !before.has(f));
  const removed = [...before].filter((f) => !after.has(f));
  const parts: string[] = [];
  if (added.length > 0) parts.push(`+${added.join("、")}`);
  if (removed.length > 0) parts.push(`−${removed.join("、")}`);
  return parts.join(" ");
}

/**
 * 渲染纪元注入的目录全文。
 * @param index MEMORY.yaml 解析结果
 * @param presetEntries preset 扫描产物（系统扫描，agent 不可写）
 * @param problems 校验错误（注入兜底：非空时以修复指引替代正文）
 */
export function renderMemoryBlock(
  index: MemoryIndex,
  presetEntries: readonly { name: string; desc: string; path: string }[],
  problems?: readonly string[],
): string {
  if (problems !== undefined && problems.length > 0) {
    return [
      `<memory version="${index.version}">`,
      "MEMORY.yaml 体系校验未通过，请立即修复（修复后下一输入恢复完整目录注入）：",
      ...problems.slice(0, 8).map((p) => `- ${p}`),
      problems.length > 8 ? `- …等 ${problems.length} 项` : "",
      "</memory>",
    ]
      .filter((l) => l !== "")
      .join("\n");
  }

  const lines: string[] = [`<memory version="${index.version}">`];
  let hasEntry = false;
  for (const domain of MEMORY_DOMAINS) {
    const entries = index[domain] ?? [];
    for (const e of entries) {
      if (!hasEntry) {
        lines.push("## 动态案例库（对话入库；闸门见「记忆偏好案例库」）");
        hasEntry = true;
      }
      lines.push(`- ${domain} · ${e.name} —— ${e.desc} —— ${e.path}`);
    }
  }
  if (!hasEntry && presetEntries.length === 0 && (index.usedPresets ?? []).length === 0) {
    lines.push("（尚无任何案例；作者表达喜欢/认可产出/要求记故事时按「记忆偏好案例库」闸门入库）");
  }
  if ((index.usedPresets ?? []).length > 0) {
    lines.push("## 已采用预设");
    for (const ref of index.usedPresets ?? []) {
      lines.push(`- ${ref}`);
    }
  }
  if (presetEntries.length > 0) {
    lines.push("## 预设（作者资产，只读；agent 不得修改）");
    for (const e of presetEntries) {
      lines.push(`- ${e.path.startsWith(".novel/preset/") ? e.path.slice(".novel/preset/".length) : e.path} —— ${e.name} —— ${e.desc}`);
    }
  }
  lines.push("</memory>");
  lines.push(
    "使用：案例与故事按需 Read 对应文件；入库/替换/采用标记经 Write/Edit 且须先经作者确认；预设（.novel/preset）只读。",
    "防抄袭：prose 仿质感与节奏，不复用其词句；story 为作者素材，可直接采用。",
  );
  const full = lines.join("\n");
  if (full.length > MEMORY_RENDER_MAX) {
    return `${full.slice(0, MEMORY_RENDER_MAX)}\n…（目录超限已截断，请整理合并类目）`;
  }
  return full;
}

/** 空树渲染（无 MEMORY.yaml 且无 preset 时的注入体） */
export function renderEmptyMemoryBlock(): string {
  return renderMemoryBlock(emptyMemoryIndex(), []);
}
