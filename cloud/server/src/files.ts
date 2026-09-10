import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import type { SseHub } from "./sse.js";
import { authGuard, type AuthedRequest } from "./auth.js";
import { appendLedgerRow } from "./ledger.js";
import { projectOwnerError, touchProjectActivity } from "./projects.js";
import { NOVEL_MD, validateContentSize, validateProjectPath, MAX_FILE_BYTES } from "./sandbox.js";

/**
 * 云项目文件 API（项目域上云 PRD FR2）：
 * - 读：GET files/*（含 NOVEL.md）；列表：GET files?prefix=；
 * - 写：PUT files/* —— 路径沙箱唯一权威判定（sandbox.ts，客户端路径不可信）；
 *   特例保留：NOVEL.md 审批唯一写径（403）；memory/<name>.md 需 source 指回真实账本行，
 *   MEMORY.md 索引由 server 维护（两层记忆 PRD 的 server 单点校验）；
 * - 删：DELETE files/*（软删回收，deleted_at 标记）；
 * - 乐观校验：expectedUpdatedAt 不符 → 409 附当前值；512KiB 上限；
 * - SSE file_changed（无 conversationId → 全局订阅者可见；会话级订阅按既有过滤屏蔽）；
 *   memory 写额外发 journal memory-write 事件（会话重放可恢复，既有行为）。
 */
export function registerFileRoutes(app: FastifyInstance, db: Db, hub: SseHub, secret: string): void {
  const guard = authGuard(secret);

  /** wildcard 原样可能带 URI 编码与前导斜杠：decode 后交沙箱判定（绝对形态由沙箱识别） */
  const wildcardPath = (request: { params: Record<string, string> }): string | { error: string } => {
    const raw = request.params["*"] ?? "";
    try {
      return decodeURIComponent(raw);
    } catch {
      return { error: "路径编码非法" };
    }
  };

  app.get("/v1/projects/:projectId/files/*", { preHandler: guard }, async (request, reply) => {
    const user = (request as unknown as AuthedRequest).user;
    const { projectId } = request.params as { projectId: string };
    const path = wildcardPath(request as never as { params: Record<string, string> });
    if (typeof path !== "string") return reply.code(400).send({ code: "bad_path", message: path.error });
    const check = validateProjectPath(path);
    if (!check.ok) return reply.code(400).send({ code: check.code, message: check.message });
    const ownerError = projectOwnerError(db, user.userId, projectId);
    if (ownerError) return reply.code(ownerError.status).send({ code: ownerError.code, message: "项目不存在或无权访问" });
    const row = db
      .prepare("SELECT content, updated_at FROM project_files WHERE project_id = ? AND path = ? AND deleted_at IS NULL")
      .get(projectId, check.path) as { content: string; updated_at: number } | undefined;
    if (!row) return reply.code(404).send({ code: "not_found", message: `文件 ${check.path} 不存在` });
    return reply.send({ path: check.path, content: row.content, updatedAt: row.updated_at });
  });

  app.get("/v1/projects/:projectId/files", { preHandler: guard }, async (request, reply) => {
    const user = (request as unknown as AuthedRequest).user;
    const { projectId } = request.params as { projectId: string };
    const query = request.query as { prefix?: string };
    const ownerError = projectOwnerError(db, user.userId, projectId);
    if (ownerError) return reply.code(ownerError.status).send({ code: ownerError.code, message: "项目不存在或无权访问" });
    // prefix 归一：空 = 全量；非空须落在 allowlist 边界内（chapters、chapters/、chapters/第10卷/…）
    let prefix = "";
    if (query.prefix !== undefined && query.prefix !== "") {
      const raw = query.prefix.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
      const check = validateProjectPath(`${raw}/x`);
      if (!check.ok) return reply.code(400).send({ code: "bad_path", message: `prefix 非法：${check.message}` });
      prefix = `${raw}/`;
    }
    const rows = db
      .prepare(
        `SELECT path, updated_at, LENGTH(content) AS size FROM project_files
         WHERE project_id = ? AND deleted_at IS NULL AND path LIKE ? ESCAPE '\\'
         ORDER BY path`
      )
      .all(projectId, `${prefix.replace(/[%_\\]/g, (m) => `\\${m}`)}%`) as Array<{ path: string; updated_at: number; size: number }>;
    return { files: rows.map((r) => ({ path: r.path, updatedAt: r.updated_at, size: r.size })) };
  });

  app.put("/v1/projects/:projectId/files/*", { preHandler: guard }, async (request, reply) => {
    const user = (request as unknown as AuthedRequest).user;
    const { projectId } = request.params as { projectId: string };
    const path = wildcardPath(request as never as { params: Record<string, string> });
    if (typeof path !== "string") return reply.code(400).send({ code: "bad_path", message: path.error });
    const body = request.body as { content?: string; source?: number; conversationId?: string; expectedUpdatedAt?: number };
    const ownerError = projectOwnerError(db, user.userId, projectId);
    if (ownerError) return reply.code(ownerError.status).send({ code: ownerError.code, message: "项目不存在或无权访问" });

    // ---- 沙箱（唯一权威判定）----
    const check = validateProjectPath(path);
    if (!check.ok) return reply.code(400).send({ code: check.code, message: check.message });
    const canonical = check.path;

    // ---- 特例：NOVEL.md 审批唯一写径 ----
    if (canonical === NOVEL_MD) {
      return reply.code(403).send({
        code: "novel_md_requires_approval",
        message: "NOVEL.md 只能经审批提案变更：POST /v1/approvals 携带 proposal，resolve approve 后由 server 落盘",
      });
    }
    if (typeof body?.content !== "string") {
      return reply.code(400).send({ code: "bad_request", message: "缺少 content" });
    }
    const size = validateContentSize(body.content);
    if (!size.ok) return reply.code(413).send({ code: size.code, message: size.message });

    // ---- 特例：memory/<name>.md 的 source 追溯校验 + 索引维护 ----
    const isMemory = canonical.startsWith("memory/");
    if (isMemory) {
      if (!canonical.endsWith(".md") || canonical === "memory/MEMORY.md") {
        return reply.code(400).send({ code: "bad_path", message: "memory 下可写路径仅限 <name>.md（索引由 server 维护）" });
      }
      if (typeof body.source !== "number" || !db.prepare("SELECT 1 FROM journal_events WHERE seq = ?").get(body.source)) {
        return reply.code(400).send({
          code: "invalid_source",
          message: "source 必填且必须指向已存在的账本 seq（memory 只记录可追溯的学到内容）",
        });
      }
    }

    // ---- 乐观校验（expectedUpdatedAt；memory 写不走此径——server 单点维护索引一致性）----
    if (!isMemory && body.expectedUpdatedAt !== undefined) {
      const existing = db
        .prepare("SELECT updated_at FROM project_files WHERE project_id = ? AND path = ? AND deleted_at IS NULL")
        .get(projectId, canonical) as { updated_at: number } | undefined;
      const current = existing?.updated_at ?? 0;
      if (current !== body.expectedUpdatedAt) {
        return reply.code(409).send({
          code: "stale_file",
          currentUpdatedAt: current,
          message: current === 0 ? "文件不存在（先读再写）" : "文件已被并发修改，请重读最新内容",
        });
      }
    }

    const now = Date.now();
    const upsert = db.prepare(
      `INSERT INTO project_files (project_id, path, content, updated_at, deleted_at) VALUES (?, ?, ?, ?, NULL)
       ON CONFLICT (project_id, path) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at, deleted_at = NULL`
    );
    const tx = db.transaction((): number | undefined => {
      upsert.run(projectId, canonical, body.content!, now);
      touchProjectActivity(db, projectId, now);
      if (isMemory) {
        // 索引一致性由 server 维护：一行一条
        const name = canonical.slice("memory/".length);
        const indexRow = db.prepare("SELECT content FROM project_files WHERE project_id = ? AND path = 'memory/MEMORY.md'")
          .get(projectId) as { content: string } | undefined;
        const entry = `- ${name}（source=seq:${body.source}）`;
        const existingLines = (indexRow?.content ?? "").split("\n").filter(Boolean);
        const updated = existingLines.filter((l: string) => !l.startsWith(`- ${name}（`)).concat(entry).sort();
        db.prepare(
          `INSERT INTO project_files (project_id, path, content, updated_at) VALUES (?, 'memory/MEMORY.md', ?, ?)
           ON CONFLICT (project_id, path) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`
        ).run(projectId, updated.join("\n"), now);
        return appendLedgerRow(db, body.conversationId ?? "", -1, "memory-write", {
          path: canonical,
          source: body.source,
          actor: user.userId,
        });
      }
      return undefined;
    });
    const seq = tx();
    hub.publish({ type: "file_changed", projectId, path: canonical, op: "write", updatedAt: now });
    if (isMemory && seq !== undefined) {
      hub.publish({ type: "journal", conversationId: body.conversationId ?? "", seq, runSeq: -1, kind: "memory-write", payload: { path: canonical } });
    }
    return reply.send({ path: canonical, updatedAt: now, ...(seq !== undefined ? { seq } : {}) });
  });

  app.delete("/v1/projects/:projectId/files/*", { preHandler: guard }, async (request, reply) => {
    const user = (request as unknown as AuthedRequest).user;
    const { projectId } = request.params as { projectId: string };
    const path = wildcardPath(request as never as { params: Record<string, string> });
    if (typeof path !== "string") return reply.code(400).send({ code: "bad_path", message: path.error });
    const body = request.body as { expectedUpdatedAt?: number } | null;
    const ownerError = projectOwnerError(db, user.userId, projectId);
    if (ownerError) return reply.code(ownerError.status).send({ code: ownerError.code, message: "项目不存在或无权访问" });
    const check = validateProjectPath(path);
    if (!check.ok) return reply.code(400).send({ code: check.code, message: check.message });
    if (check.path === NOVEL_MD || check.path === "memory/MEMORY.md") {
      return reply.code(400).send({ code: "bad_path", message: "该文件不可删除" });
    }
    const existing = db
      .prepare("SELECT updated_at FROM project_files WHERE project_id = ? AND path = ? AND deleted_at IS NULL")
      .get(projectId, check.path) as { updated_at: number } | undefined;
    if (!existing) return reply.code(404).send({ code: "not_found", message: `文件 ${check.path} 不存在` });
    if (body?.expectedUpdatedAt !== undefined && body.expectedUpdatedAt !== existing.updated_at) {
      return reply.code(409).send({ code: "stale_file", currentUpdatedAt: existing.updated_at, message: "文件已被并发修改" });
    }
    const now = Date.now();
    db.prepare("UPDATE project_files SET deleted_at = ? WHERE project_id = ? AND path = ?").run(now, projectId, check.path);
    touchProjectActivity(db, projectId, now);
    hub.publish({ type: "file_changed", projectId, path: check.path, op: "delete", updatedAt: now });
    return reply.code(204).send();
  });
}

export function newProjectId(): string {
  return `prj_${crypto.randomBytes(10).toString("hex")}`;
}

export { MAX_FILE_BYTES };
