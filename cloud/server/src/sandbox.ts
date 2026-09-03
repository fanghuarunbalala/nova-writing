/**
 * 云项目文件路径沙箱（项目域上云 PRD §1 层 1）。
 * 纯函数、无 IO：所有文件 API 的路径在此做唯一权威判定（客户端传来的路径一律不可信）。
 * 语义对齐桌面端 files.ts 的 resolveInWorkspace（逃逸拒绝 + 顶层 allowlist），并在
 * server 侧追加：黑名单段、长度上限、盘符/UNC/空字节拒绝——server 是公网面，收紧一档。
 */

/** 顶层可写 allowlist（前缀）；NOVEL.md 单列（读可、写走审批） */
export const ALLOWED_TOP_PREFIXES = ["chapters/", "notes/", "memory/", "design/", ".novel/cases/"] as const;
export const NOVEL_MD = "NOVEL.md";
/** 单文件内容上限（对齐桌面 files 工具 512KiB） */
export const MAX_FILE_BYTES = 512 * 1024;
/** 路径长度上限（canonical posix 形式） */
const MAX_PATH_LENGTH = 240;
/** 黑名单路径段（.git 仓库元数据 / .env* 凭据文件） */
const BLOCKED_SEGMENTS = [".git"];
const BLOCKED_NAME_PREFIXES = [".env"];

export type PathCheck =
  | { ok: true; path: string }
  | { ok: false; code: "empty_path" | "escape" | "absolute" | "drive_letter" | "null_byte" | "too_long" | "blocked_segment" | "outside_allowlist" | "too_large"; message: string };

/**
 * 校验并归一化项目相对路径。
 * @param raw 客户端原始路径（允许反斜杠，统一归一为 posix）
 * @returns ok 时给出 canonical posix 相对路径；错误附 code 与中文 message
 */
export function validateProjectPath(raw: string): PathCheck {
  if (typeof raw !== "string" || raw.length === 0) {
    return { ok: false, code: "empty_path", message: "路径为空" };
  }
  if (raw.includes("\0")) {
    return { ok: false, code: "null_byte", message: "路径包含空字节" };
  }
  // 绝对形态（posix / 与 Windows 盘符/UNC）先拒——归一前判定
  if (raw.includes("\\")) {
    if (/^[a-zA-Z]:/.test(raw) || raw.startsWith("\\\\") || raw.startsWith("\/")) {
      return { ok: false, code: "absolute", message: "不允许绝对路径" };
    }
  }
  if (raw.startsWith("/") || /^[a-zA-Z]:/.test(raw) || raw.startsWith("\\\\")) {
    return { ok: false, code: "absolute", message: "不允许绝对路径" };
  }
  // 归一：反斜杠 → /；折叠连续分隔符；剥前导 ./
  let path = raw.replace(/\\/g, "/").replace(/\/+/g, "/");
  while (path.startsWith("./")) path = path.slice(2);
  if (path.length === 0) return { ok: false, code: "empty_path", message: "路径为空" };
  // 逃逸：任何 .. 段（含 URL 编码变体交由调用方 decode 后再审——本函数要求已 decode）
  const segments = path.split("/");
  if (segments.some((s) => s === "..")) {
    return { ok: false, code: "escape", message: "路径不得包含 ..（不允许逃逸项目根）" };
  }
  if (segments.some((s) => s.length === 0)) {
    return { ok: false, code: "escape", message: "路径段为空" };
  }
  // 盘符二次防御（a: 形态藏在非首段）
  if (segments.some((s) => /^[a-zA-Z]:$/.test(s))) {
    return { ok: false, code: "drive_letter", message: "路径包含盘符" };
  }
  // 黑名单段
  for (const s of segments) {
    if (BLOCKED_SEGMENTS.includes(s)) {
      return { ok: false, code: "blocked_segment", message: `路径段 ${s} 被禁止` };
    }
    if (BLOCKED_NAME_PREFIXES.some((p) => s.startsWith(p))) {
      return { ok: false, code: "blocked_segment", message: `路径段 ${s} 被禁止（凭据文件）` };
    }
  }
  if (path.length > MAX_PATH_LENGTH) {
    return { ok: false, code: "too_long", message: `路径超过 ${MAX_PATH_LENGTH} 字符上限` };
  }
  // 顶层 allowlist：NOVEL.md 或前缀之一
  const allowed =
    path === NOVEL_MD || ALLOWED_TOP_PREFIXES.some((p) => path === p || path.startsWith(p));
  if (!allowed) {
    return {
      ok: false,
      code: "outside_allowlist",
      message: `路径不在可写范围（允许顶层：${[...ALLOWED_TOP_PREFIXES, NOVEL_MD].join(" ")}）`,
    };
  }
  return { ok: true, path };
}

/** 内容大小校验（UTF-8 字节数）。 */
export function validateContentSize(content: string): PathCheck {
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_FILE_BYTES) {
    return { ok: false, code: "too_large", message: `内容超过 ${MAX_FILE_BYTES} 字节上限` };
  }
  return { ok: true, path: "" };
}
