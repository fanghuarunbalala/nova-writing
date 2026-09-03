import type { FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import { authGuard, type AuthedRequest } from "./auth.js";

/**
 * 项目生命周期（项目域上云 PRD FR1）：列表 / 改名归档 / 软删。
 * owner-only（M1 权限模型沿用）；last_activity_at 由文件/域写路径在同一事务内 touch，
 * 列表按活跃度排序 = 「最近的项目」的云端来源。
 */
export interface ProjectRow {
  id: string;
  owner_id: string;
  name: string;
  created_at: number;
  last_activity_at: number | null;
  archived_at: number | null;
  deleted_at: number | null;
}

/** touch 项目活跃度（文件/域写事务内调用） */
export function touchProjectActivity(db: Db, projectId: string, now: number): void {
  db.prepare("UPDATE projects SET last_activity_at = ? WHERE id = ?").run(now, projectId);
}

/** DB 行 → API 投影（snake → camel；deleted 不出列表面） */
function toApi(row: Omit<ProjectRow, "owner_id">): {
  id: string;
  name: string;
  createdAt: number;
  lastActivityAt: number | null;
  archivedAt: number | null;
} {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
    archivedAt: row.archived_at,
  };
}

/** owner 校验：返回错误码或 null（含软删项目不可见） */
export function projectOwnerError(
  db: Db,
  userId: string,
  projectId: string,
): { code: "not_found" | "forbidden"; status: 404 | 403 } | null {
  const row = db
    .prepare("SELECT owner_id, deleted_at FROM projects WHERE id = ?")
    .get(projectId) as Pick<ProjectRow, "owner_id" | "deleted_at"> | undefined;
  if (!row || row.deleted_at !== null) return { code: "not_found", status: 404 };
  if (row.owner_id !== userId) return { code: "forbidden", status: 403 };
  return null;
}

export function registerProjectRoutes(app: FastifyInstance, db: Db, secret: string): void {
  const guard = authGuard(secret);

  app.get("/v1/projects", { preHandler: guard }, async (request) => {
    const user = (request as unknown as AuthedRequest).user;
    const rows = db
      .prepare(
        `SELECT id, name, created_at, last_activity_at, archived_at, deleted_at
         FROM projects WHERE owner_id = ? AND deleted_at IS NULL
         ORDER BY COALESCE(last_activity_at, created_at) DESC`
      )
      .all(user.userId) as Array<Omit<ProjectRow, "owner_id">>;
    return { projects: rows.map(toApi) };
  });

  app.patch("/v1/projects/:projectId", { preHandler: guard }, async (request, reply) => {
    const user = (request as unknown as AuthedRequest).user;
    const projectId = (request.params as { projectId: string }).projectId;
    const body = request.body as { name?: string; archived?: boolean };
    const ownerError = projectOwnerError(db, user.userId, projectId);
    if (ownerError) return reply.code(ownerError.status).send({ code: ownerError.code, message: "项目不存在或无权访问" });
    if (body?.name !== undefined) {
      const name = body.name.trim();
      if (name.length === 0 || name.length > 64) {
        return reply.code(400).send({ code: "bad_name", message: "项目名需 1 – 64 字符" });
      }
      db.prepare("UPDATE projects SET name = ? WHERE id = ?").run(name, projectId);
    }
    if (body?.archived !== undefined) {
      db.prepare("UPDATE projects SET archived_at = ? WHERE id = ?").run(body.archived ? Date.now() : null, projectId);
    }
    const row = db
      .prepare("SELECT id, name, created_at, last_activity_at, archived_at FROM projects WHERE id = ?")
      .get(projectId) as Omit<ProjectRow, "owner_id" | "deleted_at">;
    return reply.send({ project: toApi(row) });
  });

  app.delete("/v1/projects/:projectId", { preHandler: guard }, async (request, reply) => {
    const user = (request as unknown as AuthedRequest).user;
    const projectId = (request.params as { projectId: string }).projectId;
    const ownerError = projectOwnerError(db, user.userId, projectId);
    if (ownerError) return reply.code(ownerError.status).send({ code: ownerError.code, message: "项目不存在或无权访问" });
    // 软删（回收语义）：域表/文件/账本行保留，列表与 owner 校验即不可见
    db.prepare("UPDATE projects SET deleted_at = ? WHERE id = ?").run(Date.now(), projectId);
    return reply.code(204).send();
  });
}
