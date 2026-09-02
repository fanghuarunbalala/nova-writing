import type { FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import type { SseHub } from "./sse.js";
import { authGuard, type AuthedRequest } from "./auth.js";
import { checkLease } from "./lease.js";
import { appendLedgerRow } from "./ledger.js";

/**
 * 小说域写路径（PRD FR3）：条件更新乐观锁 + 账本记账在**同一个 SQLite 事务**内——
 * 消除「域数据变了但账本没记」的窗口，账本天然是可重放变更流。
 * 语义对齐桌面端 SqliteNovelStore.checkRevision：版本过期 → 409 附当前版本号（模型自纠）。
 */
export function registerDomainRoutes(app: FastifyInstance, db: Db, hub: SseHub, secret: string): void {
  const guard = authGuard(secret);

  app.get("/v1/paragraphs", { preHandler: guard }, async (request, reply) => {
    const user = (request as unknown as AuthedRequest).user;
    const query = request.query as { projectId?: string; storyUnitId?: string };
    if (!query.projectId) return reply.code(400).send({ code: "bad_request", message: "缺少 projectId" });
    const project = db.prepare("SELECT owner_id FROM projects WHERE id = ?").get(query.projectId) as
      | { owner_id: string }
      | undefined;
    if (!project) return reply.code(404).send({ code: "not_found", message: "项目不存在" });
    if (project.owner_id !== user.userId) return reply.code(403).send({ code: "forbidden", message: "非项目所有者" });
    const rows = query.storyUnitId
      ? db.prepare("SELECT * FROM paragraphs WHERE project_id = ? AND story_unit_id = ? ORDER BY order_key")
          .all(query.projectId, query.storyUnitId)
      : db.prepare("SELECT * FROM paragraphs WHERE project_id = ? ORDER BY story_unit_id, order_key")
          .all(query.projectId);
    return reply.send({ paragraphs: rows });
  });

  app.post("/v1/paragraphs/mutate", { preHandler: guard }, async (request, reply) => {
    const user = (request as unknown as AuthedRequest).user;
    const body = request.body as {
      projectId?: string;
      conversationId?: string;
      leaseToken?: string;
      mutation?: {
        op: "write" | "delete";
        id: string;
        storyUnitId?: string;
        orderKey?: number;
        text?: string;
        baseRevision?: number;
      };
    };
    const mutation = body?.mutation;
    if (!body?.projectId || !mutation?.id || (mutation.op !== "write" && mutation.op !== "delete")) {
      return reply.code(400).send({ code: "bad_request", message: "mutation 不合法" });
    }
    const project = db.prepare("SELECT owner_id FROM projects WHERE id = ?").get(body.projectId) as
      | { owner_id: string }
      | undefined;
    if (!project) return reply.code(404).send({ code: "not_found", message: "项目不存在" });
    if (project.owner_id !== user.userId) return reply.code(403).send({ code: "forbidden", message: "非项目所有者" });

    // 域写发生在某会话的 run 内 → 必须持有该会话租约
    const lease = checkLease(db, body.conversationId ?? "", body.leaseToken, user.userId);
    if (!lease.ok) {
      const status = lease.code === "lease_required" ? 400 : lease.code === "lease_taken" ? 423 : 410;
      return reply.code(status).send({ code: lease.code, message: "无有效租约" });
    }

    const now = Date.now();
    let result: { entityVersion?: number } = {};
    const runSeq = -1; // 域记账行：run_seq = -1 表示「非 run 直接上推的域写」
    try {
      const tx = db.transaction((): number => {
        if (mutation.op === "write") {
          if (mutation.storyUnitId === undefined || mutation.orderKey === undefined || mutation.text === undefined) {
            throw new BadMutation("write 需要 storyUnitId/orderKey/text");
          }
          const existing = db
            .prepare("SELECT entity_version FROM paragraphs WHERE id = ? AND project_id = ?")
            .get(mutation.id, body.projectId) as { entity_version: number } | undefined;
          if (existing) {
            if (mutation.baseRevision === undefined) {
              throw new Conflict(existing.entity_version);
            }
            const changes = db
              .prepare(
                `UPDATE paragraphs SET story_unit_id = ?, order_key = ?, text = ?,
                 entity_version = entity_version + 1, updated_at = ?
                 WHERE id = ? AND project_id = ? AND entity_version = ?`
              )
              .run(mutation.storyUnitId, mutation.orderKey, mutation.text, now, mutation.id, body.projectId, mutation.baseRevision);
            if (changes.changes === 0) {
              throw new Conflict(existing.entity_version);
            }
            result = { entityVersion: existing.entity_version + 1 };
          } else {
            if (mutation.baseRevision !== undefined) {
              throw new Conflict(0, "实体不存在，不应携带 baseRevision");
            }
            db.prepare(
              `INSERT INTO paragraphs (id, project_id, story_unit_id, order_key, entity_version, text, updated_at)
               VALUES (?, ?, ?, ?, 1, ?, ?)`
            ).run(mutation.id, body.projectId, mutation.storyUnitId, mutation.orderKey, mutation.text, now);
            result = { entityVersion: 1 };
          }
        } else {
          if (mutation.baseRevision === undefined) {
            throw new BadMutation("delete 需要 baseRevision");
          }
          const changes = db
            .prepare("DELETE FROM paragraphs WHERE id = ? AND project_id = ? AND entity_version = ?")
            .run(mutation.id, body.projectId, mutation.baseRevision);
          if (changes.changes === 0) {
            const existing = db
              .prepare("SELECT entity_version FROM paragraphs WHERE id = ? AND project_id = ?")
              .get(mutation.id, body.projectId) as { entity_version: number } | undefined;
            throw new Conflict(existing?.entity_version ?? 0);
          }
        }
        // 同事务记账：域变更是事件流的一部分
        return appendLedgerRow(db, body.conversationId ?? "", runSeq, "domain-mutation", {
          mutation,
          actor: user.userId,
          result,
        });
      });
      const seq = tx();
      hub.publish({
        type: "journal",
        conversationId: body.conversationId ?? "",
        seq,
        runSeq,
        kind: "domain-mutation",
        payload: { mutation, result },
      });
      return reply.send({ ...result, seq });
    } catch (e) {
      if (e instanceof Conflict) {
        return reply.code(409).send({ code: "stale_revision", currentVersion: e.currentVersion, message: e.message });
      }
      if (e instanceof BadMutation) {
        return reply.code(400).send({ code: "bad_mutation", message: e.message });
      }
      throw e;
    }
  });
}

class Conflict extends Error {
  constructor(public currentVersion: number, message = "版本过期，请重读最新内容后再改") {
    super(message);
  }
}

class BadMutation extends Error {}
