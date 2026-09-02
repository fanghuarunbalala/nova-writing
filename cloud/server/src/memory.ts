import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import type { SseHub } from "./sse.js";
import { authGuard, type AuthedRequest } from "./auth.js";
import { appendLedgerRow } from "./ledger.js";

/**
 * memory / NOVEL.md（两层记忆 PRD 的 server 侧落点 + 端云 PRD FR6）：
 * - memory/<name>.md：模型写入权，但校验单点在 server——source 必填且必须指回真实账本行；
 *   索引（MEMORY.md）由 server 维护一致性；写入同事务记账。
 * - NOVEL.md：人拥有写入权，模型/任何 API 只能经审批提案变更（approvals resolve 落盘，见 approvals.ts）。
 */
export function registerMemoryRoutes(app: FastifyInstance, db: Db, hub: SseHub, secret: string): void {
  const guard = authGuard(secret);

  const ownedProject = (userId: string, projectId: string): boolean => {
    const row = db.prepare("SELECT owner_id FROM projects WHERE id = ?").get(projectId) as
      | { owner_id: string }
      | undefined;
    return row?.owner_id === userId;
  };

  app.get("/v1/projects/:projectId/files/*", { preHandler: guard }, async (request, reply) => {
    const user = (request as unknown as AuthedRequest).user;
    const { projectId } = request.params as { projectId: string };
    const path = ((request.params as Record<string, string>)["*"] ?? "").replace(/^\/+/, "");
    if (!ownedProject(user.userId, projectId)) return reply.code(403).send({ code: "forbidden" });
    const row = db.prepare("SELECT content, updated_at FROM project_files WHERE project_id = ? AND path = ?")
      .get(projectId, path) as { content: string; updated_at: number } | undefined;
    if (!row) return reply.code(404).send({ code: "not_found", message: `文件 ${path} 不存在` });
    return reply.send({ path, content: row.content, updatedAt: row.updated_at });
  });

  app.put("/v1/projects/:projectId/files/*", { preHandler: guard }, async (request, reply) => {
    const user = (request as unknown as AuthedRequest).user;
    const { projectId } = request.params as { projectId: string };
    const path = ((request.params as Record<string, string>)["*"] ?? "").replace(/^\/+/, "");
    const body = request.body as { content?: string; source?: number; conversationId?: string };
    if (!ownedProject(user.userId, projectId)) return reply.code(403).send({ code: "forbidden" });

    if (path === "NOVEL.md") {
      return reply.code(403).send({
        code: "novel_md_requires_approval",
        message: "NOVEL.md 只能经审批提案变更：POST /v1/approvals 携带 proposal，resolve approve 后由 server 落盘",
      });
    }
    if (!path.startsWith("memory/") || !path.endsWith(".md") || path === "memory/MEMORY.md") {
      return reply.code(400).send({ code: "bad_path", message: "可写路径仅限 memory/<name>.md（索引由 server 维护）" });
    }
    if (typeof body?.content !== "string") {
      return reply.code(400).send({ code: "bad_request", message: "缺少 content" });
    }
    // memory_write 校验（四道校验的 M1 子集）：source 必填且必须指回真实账本行（可追溯）
    if (typeof body.source !== "number" || !db.prepare("SELECT 1 FROM journal_events WHERE seq = ?").get(body.source)) {
      return reply.code(400).send({
        code: "invalid_source",
        message: "source 必填且必须指向已存在的账本 seq（memory 只记录可追溯的学到内容）",
      });
    }

    const now = Date.now();
    const name = path.slice("memory/".length);
    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO project_files (project_id, path, content, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (project_id, path) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`
      ).run(projectId, path, body.content!, now);
      // 索引一致性由 server 维护：一行一条
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
        path,
        source: body.source,
        actor: user.userId,
      });
    });
    const seq = tx();
    hub.publish({ type: "journal", conversationId: body.conversationId ?? "", seq, runSeq: -1, kind: "memory-write", payload: { path } });
    return reply.send({ path, seq });
  });
}

export function newProjectId(): string {
  return `prj_${crypto.randomBytes(10).toString("hex")}`;
}
