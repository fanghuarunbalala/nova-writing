/**
 * 动态学习层存储（PRD memory-两层记忆 M2/M3）：workspace 下 memory/ 目录——
 * MEMORY.md 索引（active 条目一行一条，确定序）+ <name>.md 主题文件
 * （frontmatter + 三段式正文）。写入顺序恒为「先主题文件、后同步索引」，
 * 索引可从主题文件确定性重建（写入中断自愈）。
 *
 * 索引行格式：`- name — description（type）`；排序确定化：type 固定分组
 * （author→feedback→project→reference）、组内 name 字典序。注入预算：
 * 前 200 行 / 25 KiB，≥180 行回执提示精简，超 200 行写入成功但报错要求精简
 * （对齐 CC MEMORY.md 行为）。superseded 条目留盘可追溯、不进索引、检索可查。
 */
import { readFile, writeFile, mkdir, readdir, rm, rename } from "node:fs/promises";
import { join } from "node:path";
import type { MemoryIndexSnapshot } from "../runtime/prompt/PromptSection.js";

/** 记忆条目四类 type（对齐 CC：user→author 语义） */
export type MemoryEntryType = "author" | "feedback" | "project" | "reference";

/** 索引条目（一行一条） */
export interface MemoryIndexEntry {
  readonly name: string;
  readonly description: string;
  readonly type: MemoryEntryType;
}

/** 主题文件（frontmatter 已解析） */
export interface MemoryTopic {
  readonly name: string;
  readonly type: MemoryEntryType;
  readonly description: string;
  readonly created: string;
  readonly modified: string;
  readonly source: string;
  readonly status: "active" | "superseded";
  readonly supersededBy?: string;
  /** 正文（三段式：## 规则/事实 → ## Why → ## How to apply） */
  readonly body: string;
}

/** memory_write 输入（source 由工具宿主自动附加，不在此处） */
export interface MemoryWriteInput {
  readonly name: string;
  readonly type: MemoryEntryType;
  readonly description: string;
  readonly content: string;
  /** 本条目取代的旧条目名（改口场景：旧条目标 superseded） */
  readonly supersedes?: string;
}

/** memory_write 回执 */
export interface MemoryWriteReceipt {
  /** created=新建 / updated=同义更新 / superseded=新建并取代旧条目 */
  readonly outcome: "created" | "updated" | "superseded";
  /** 被取代的旧条目（outcome=superseded 时） */
  readonly superseded?: string;
  /** 索引当前行数 */
  readonly indexLines: number;
  /** 索引 ≥180 行（提示精简） */
  readonly indexNearLimit: boolean;
  /** 索引 >200 行（写入已成功，但要求精简——对齐 CC 超限报错行为） */
  readonly indexOverflow: boolean;
  /** 主题正文超 50 行建议（不硬拒） */
  readonly bodyTooLong: boolean;
}

/** 一致性校验报告（启动时/写入中断后） */
export interface MemoryConsistencyReport {
  /** active 条目数 */
  readonly active: number;
  /** superseded 条目数 */
  readonly superseded: number;
  /** 解析失败被跳过的文件名 */
  readonly corrupted: readonly string[];
}

/** 记忆目录名（workspace 相对） */
export const MEMORY_DIR_NAME = "memory";
/** 索引文件名 */
export const MEMORY_INDEX_FILE_NAME = "MEMORY.md";
/** 索引注入预算：行数上限（超出截断；磁盘完整） */
export const MEMORY_INDEX_MAX_LINES = 200;
/** 索引精简提示阈值 */
export const MEMORY_INDEX_NEAR_LIMIT_LINES = 180;
/** 索引注入预算：字节上限（与行数上限先到先截） */
export const MEMORY_INDEX_MAX_BYTES = 25 * 1024;
/** 主题正文建议行数上限（超限回执提示拆分，不硬拒） */
export const MEMORY_TOPIC_BODY_MAX_LINES = 50;
/** 主题名（kebab-case） */
export const MEMORY_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** type 固定分组序 */
const TYPE_ORDER: readonly MemoryEntryType[] = ["author", "feedback", "project", "reference"];

/** 索引行解析：`- name — description（type）` */
const INDEX_LINE_RE = /^- ([a-z0-9]+(?:-[a-z0-9]+)*) — (.+)（(author|feedback|project|reference)）$/;

/** 内存目录/文件路径 */
export function memoryDirPath(workspace: string): string {
  return join(workspace, MEMORY_DIR_NAME);
}
function indexPath(workspace: string): string {
  return join(memoryDirPath(workspace), MEMORY_INDEX_FILE_NAME);
}
function topicPath(workspace: string, name: string): string {
  return join(memoryDirPath(workspace), `${name}.md`);
}

/** 渲染索引行 */
export function renderIndexLine(entry: MemoryIndexEntry): string {
  return `- ${entry.name} — ${entry.description}（${entry.type}）`;
}

/** 确定序比较：type 分组序 → name 字典序 */
function compareEntries(a: MemoryIndexEntry, b: MemoryIndexEntry): number {
  const ta = TYPE_ORDER.indexOf(a.type);
  const tb = TYPE_ORDER.indexOf(b.type);
  if (ta !== tb) return ta - tb;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** 原子写（tmp + rename；Windows 不覆盖语义先 rm） */
async function writeFileAtomic(abs: string, content: string): Promise<void> {
  const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, content, "utf8");
  try {
    await rename(tmp, abs);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "EEXIST" || e.code === "EPERM" || e.code === "ENOTEMPTY") {
      await rm(tmp, { force: true });
      await rm(abs, { force: true });
      await writeFile(tmp, content, "utf8");
      await rename(tmp, abs);
      return;
    }
    await rm(tmp, { force: true });
    throw err;
  }
}

/** 解析主题文件（frontmatter + 正文；解析失败返回 undefined） */
export function parseTopic(text: string, fileName: string): MemoryTopic | undefined {
  if (!text.startsWith("---")) return undefined;
  const end = text.indexOf("\n---", 3);
  if (end < 0) return undefined;
  const head = text.slice(3, end);
  const body = text.slice(end + 4).replace(/^\n+/, "");
  const fields = new Map<string, string>();
  for (const line of head.split("\n")) {
    const m = /^([a-zA-Z-]+):\s*(.*)$/.exec(line);
    if (m !== null) fields.set(m[1] as string, (m[2] as string).trim());
  }
  const name = fields.get("name") ?? fileName.replace(/\.md$/, "");
  const type = fields.get("type");
  const description = fields.get("description") ?? "";
  const status = fields.get("status") ?? "active";
  if (!MEMORY_NAME_RE.test(name)) return undefined;
  if (type === undefined || !TYPE_ORDER.includes(type as MemoryEntryType)) return undefined;
  if (description.length === 0) return undefined;
  return {
    name,
    type: type as MemoryEntryType,
    description,
    created: fields.get("created") ?? "",
    modified: fields.get("modified") ?? "",
    source: fields.get("source") ?? "",
    status: status === "superseded" ? "superseded" : "active",
    ...(fields.get("superseded-by") !== undefined
      ? { supersededBy: fields.get("superseded-by") }
      : {}),
    body,
  };
}

/** 序列化主题文件 */
function serializeTopic(topic: MemoryTopic): string {
  const lines = [
    "---",
    `name: ${topic.name}`,
    `type: ${topic.type}`,
    `description: ${topic.description}`,
    `created: ${topic.created}`,
    `modified: ${topic.modified}`,
    `source: ${topic.source}`,
    `status: ${topic.status}`,
    ...(topic.status === "superseded" && topic.supersededBy !== undefined
      ? [`superseded-by: ${topic.supersededBy}`]
      : []),
    "---",
    "",
    topic.body.replace(/\s+$/, ""),
    "",
  ];
  return lines.join("\n");
}

/** 解析索引文本 → 条目（畸形行跳过） */
export function parseIndex(text: string): MemoryIndexEntry[] {
  const entries: MemoryIndexEntry[] = [];
  for (const line of text.split("\n")) {
    const m = INDEX_LINE_RE.exec(line.trim());
    if (m !== null) {
      entries.push({
        name: m[1] as string,
        description: m[2] as string,
        type: m[3] as MemoryEntryType,
      });
    }
  }
  return entries;
}

/** 列出 memory/ 下全部主题文件名（.md，含 superseded） */
async function listTopicFiles(workspace: string): Promise<string[]> {
  try {
    const entries = await readdir(memoryDirPath(workspace));
    return entries.filter((f) => f.endsWith(".md") && f !== MEMORY_INDEX_FILE_NAME).sort();
  } catch {
    return [];
  }
}

/** 读全部主题文件（解析失败的记入 corrupted） */
async function readAllTopics(
  workspace: string,
): Promise<{ topics: MemoryTopic[]; corrupted: string[] }> {
  const topics: MemoryTopic[] = [];
  const corrupted: string[] = [];
  for (const file of await listTopicFiles(workspace)) {
    let text: string;
    try {
      text = await readFile(topicPath(workspace, file.replace(/\.md$/, "")), "utf8");
    } catch {
      corrupted.push(file);
      continue;
    }
    const parsed = parseTopic(text, file);
    if (parsed === undefined) corrupted.push(file);
    else topics.push(parsed);
  }
  return { topics, corrupted };
}

/**
 * 同步索引：以主题文件为准重建 MEMORY.md（active 条目、确定序）。
 * 这是索引的唯一维护路径——每次写入后调用，中断自愈。
 * @returns 同步后 active 条目数
 */
export async function syncMemoryIndex(workspace: string): Promise<number> {
  const { topics } = await readAllTopics(workspace);
  const active = topics
    .filter((t) => t.status === "active")
    .map((t) => ({ name: t.name, description: t.description, type: t.type }))
    .sort(compareEntries);
  const content =
    active.length === 0
      ? ""
      : `${active.map(renderIndexLine).join("\n")}\n`;
  await mkdir(memoryDirPath(workspace), { recursive: true });
  await writeFileAtomic(indexPath(workspace), content);
  return active.length;
}

/** 读主题文件 */
export async function readMemoryTopic(
  workspace: string,
  name: string,
): Promise<MemoryTopic | undefined> {
  if (!MEMORY_NAME_RE.test(name)) return undefined;
  try {
    const text = await readFile(topicPath(workspace, name), "utf8");
    return parseTopic(text, `${name}.md`);
  } catch {
    return undefined;
  }
}

/**
 * 写入记忆（memory_write 通道，四道校验在工具层；此处做结构校验与落盘）：
 * 同名存在 → 同义更新（保留 created/source，刷新 modified）；带 supersedes →
 * 旧条目标 superseded（先写新文件、再标旧文件、最后同步索引——重建幂等）。
 */
export async function writeMemoryTopic(
  workspace: string,
  input: MemoryWriteInput,
  source: string,
): Promise<MemoryWriteReceipt> {
  const now = new Date().toISOString();
  const existing = await readMemoryTopic(workspace, input.name);
  let outcome: MemoryWriteReceipt["outcome"] = "created";
  let superseded: string | undefined;
  // 校验 supersedes：目标必须存在且为 active
  let supersedesTarget: MemoryTopic | undefined;
  if (input.supersedes !== undefined && input.supersedes !== input.name) {
    supersedesTarget = await readMemoryTopic(workspace, input.supersedes);
    if (supersedesTarget === undefined || supersedesTarget.status !== "active") {
      throw new Error(
        `supersedes 目标无效：${input.supersedes}（不存在或已 superseded；请先 memory_search 确认）`,
      );
    }
  }
  const topic: MemoryTopic = {
    name: input.name,
    type: input.type,
    description: input.description,
    created: existing?.created !== undefined && existing.created.length > 0 ? existing.created : now,
    modified: now,
    source: existing?.source !== undefined && existing.source.length > 0 ? existing.source : source,
    status: "active",
    body: input.content,
  };
  await mkdir(memoryDirPath(workspace), { recursive: true });
  // ① 先写新主题文件
  await writeFileAtomic(topicPath(workspace, topic.name), serializeTopic(topic));
  if (existing !== undefined) outcome = "updated";
  // ② 标记被取代的旧条目
  if (supersedesTarget !== undefined) {
    outcome = "superseded";
    superseded = supersedesTarget.name;
    await writeFileAtomic(
      topicPath(workspace, supersedesTarget.name),
      serializeTopic({ ...supersedesTarget, status: "superseded", modified: now, supersededBy: topic.name }),
    );
  }
  // ③ 同步索引（以主题文件为准）
  const indexLines = await syncMemoryIndex(workspace);
  return {
    outcome,
    ...(superseded !== undefined ? { superseded } : {}),
    indexLines,
    indexNearLimit: indexLines >= MEMORY_INDEX_NEAR_LIMIT_LINES,
    indexOverflow: indexLines > MEMORY_INDEX_MAX_LINES,
    bodyTooLong: input.content.split("\n").length > MEMORY_TOPIC_BODY_MAX_LINES,
  };
}

/** 遗忘（物理删除主题文件 + 同步索引）；条目不存在返回 false */
export async function forgetMemoryTopic(workspace: string, name: string): Promise<boolean> {
  if (!MEMORY_NAME_RE.test(name)) return false;
  const existing = await readMemoryTopic(workspace, name);
  if (existing === undefined) return false;
  try {
    await rm(topicPath(workspace, name), { force: true });
  } catch {
    return false;
  }
  await syncMemoryIndex(workspace);
  return true;
}

/**
 * 词法检索（对齐 DeferredToolRegistry 打分口径）：查询按空白分词、大小写不敏感，
 * 逐词「名称精确=3 > 名称包含=2 > 描述包含=1」累加；同分按 name 字典序；
 * maxResults 截断。扫描全部主题文件（含 superseded——检索可查、注入不可见）。
 */
export async function searchMemoryTopics(
  workspace: string,
  query: string,
  maxResults = 5,
): Promise<(MemoryIndexEntry & { status: "active" | "superseded" })[]> {
  const { topics } = await readAllTopics(workspace);
  const tokens = query.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return [];
  const scored = topics
    .map((t) => {
      const nameL = t.name.toLowerCase();
      const descL = t.description.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (nameL === token) score += 3;
        else if (nameL.includes(token)) score += 2;
        if (descL.includes(token)) score += 1;
      }
      return { entry: t, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => (b.score - a.score !== 0 ? b.score - a.score : compareEntries(a.entry, b.entry)))
    .slice(0, Math.max(1, maxResults));
  return scored.map((s) => ({
    name: s.entry.name,
    description: s.entry.description,
    type: s.entry.type,
    status: s.entry.status,
  }));
}

/**
 * 注入快照：active 条目、确定序、预算截断（200 行 / 25 KiB 先到先截）。
 * types 提供时按 type 过滤（Compose 侧只注入 author/feedback）。
 * 目录缺失/无 active 条目返回 undefined（memory.index 段省略，对齐 skill.index 先例）。
 */
export async function readMemoryIndexForInjection(
  workspace: string,
  options?: { types?: readonly MemoryEntryType[] },
): Promise<MemoryIndexSnapshot | undefined> {
  const { topics } = await readAllTopics(workspace);
  const filter = options?.types;
  const active = topics
    .filter((t) => t.status === "active" && (filter === undefined || filter.includes(t.type)))
    .map((t) => ({ name: t.name, description: t.description, type: t.type }))
    .sort(compareEntries);
  if (active.length === 0) return undefined;
  // 预算：先按行数（一行一条），再按累计字节
  let entries = active.slice(0, MEMORY_INDEX_MAX_LINES);
  let truncated = active.length > entries.length;
  let bytes = 0;
  const kept: typeof entries = [];
  for (const entry of entries) {
    const lineBytes = Buffer.byteLength(renderIndexLine(entry), "utf8") + 1;
    if (bytes + lineBytes > MEMORY_INDEX_MAX_BYTES) {
      truncated = true;
      break;
    }
    bytes += lineBytes;
    kept.push(entry);
  }
  entries = kept;
  if (entries.length === 0) return undefined;
  return { entries, truncated };
}

/**
 * skip 机械校验（PRD 4.4）：description 或正文首条规则在两层 NOVEL.md 任一文本中
 * 逐字出现（≥8 字符、大小写不敏感）→ 判定「静态层已声明」，拒绝写入动态层。
 * 语义级判定（实体库可查等）由工具 promptDetail 指引承担，不在此处。
 */
export function overlapsStaticLayer(
  description: string,
  content: string,
  staticTexts: readonly (string | undefined)[],
): string | undefined {
  const firstRule =
    content
      .split("\n")
      .filter((l) => !l.startsWith("#") && !l.startsWith("---"))
      .map((l) => l.replace(/^[-*\s]+/, "").trim())
      .find((l) => l.length >= 5) ?? "";
  for (const text of staticTexts) {
    if (text === undefined) continue;
    const hay = text.toLowerCase();
    const desc = description.trim().toLowerCase();
    if (desc.length >= 5 && hay.includes(desc)) return description.trim();
    if (firstRule.length >= 5 && hay.includes(firstRule.toLowerCase())) return firstRule;
  }
  return undefined;
}

/** 一致性校验 + 重建（启动时；corrupted 文件跳过并列出） */
export async function rebuildMemoryIndex(workspace: string): Promise<MemoryConsistencyReport> {
  const { topics, corrupted } = await readAllTopics(workspace);
  const active = await syncMemoryIndex(workspace);
  return {
    active,
    superseded: topics.filter((t) => t.status === "superseded").length,
    corrupted,
  };
}

/**
 * skip 规则用的 name/description 快速重复检查：索引已有同义条目
 * （name 相同，或 description 与既有条目 description 高度重叠——互相包含）。
 * 返回冲突的既有条目名（工具层据此引导 update/supersede 而非新建）。
 */
export async function findOverlappingEntry(
  workspace: string,
  name: string,
  description: string,
): Promise<string | undefined> {
  if (description.trim().length < 8) return undefined;
  const desc = description.trim().toLowerCase();
  const { topics } = await readAllTopics(workspace);
  for (const t of topics) {
    if (t.status !== "active") continue;
    const existingDesc = t.description.trim().toLowerCase();
    if (existingDesc.length >= 8 && (existingDesc.includes(desc) || desc.includes(existingDesc))) {
      return t.name === name ? undefined : t.name;
    }
  }
  return undefined;
}
