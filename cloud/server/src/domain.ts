import type { FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import type { SseHub } from "./sse.js";
import { authGuard, type AuthedRequest } from "./auth.js";
import { checkLease } from "./lease.js";
import { appendLedgerRow } from "./ledger.js";
import { projectOwnerError, touchProjectActivity } from "./projects.js";

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

  registerCloudDomainRoutes(app, db, hub, secret);
}

class Conflict extends Error {
  constructor(public currentVersion: number, message = "版本过期，请重读最新内容后再改") {
    super(message);
  }
}

class BadMutation extends Error {}

/* ============================================================
 * 云项目域 API（项目域上云 PRD FR3）：通用实体存储（domain_entities）。
 * - kind 化实体（outline/chapter/character/location/paragraph/…）：data 为 JSON 文档，
 *   entity_version 乐观锁 + 项目内单调 seq（delta 游标）；
 * - snapshot 首拉 / delta 增量（SSE domain_changed 触发）/ mutate 批量（租约校验，
 *   同事务记账 + 广播），409 附 currentVersion 供客户端自纠；
 * - 与 legacy paragraphs 两路由并存（M1 契约，e2e 依赖），云项目只用本组新径。
 * ============================================================ */

interface DomainEntityMutation {
  kind: string;
  id: string;
  op: "put" | "delete";
  data?: unknown;
  baseVersion?: number;
}

const KIND_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

function registerCloudDomainRoutes(app: FastifyInstance, db: Db, hub: SseHub, secret: string): void {
  const guard = authGuard(secret);

  app.get("/v1/projects/:projectId/domain/snapshot", { preHandler: guard }, async (request, reply) => {
    const user = (request as unknown as AuthedRequest).user;
    const { projectId } = request.params as { projectId: string };
    const ownerError = projectOwnerError(db, user.userId, projectId);
    if (ownerError) return reply.code(ownerError.status).send({ code: ownerError.code, message: "项目不存在或无权访问" });
    const rows = db
      .prepare("SELECT id, kind, entity_version, data, seq, updated_at, deleted_at FROM domain_entities WHERE project_id = ? ORDER BY seq")
      .all(projectId) as Array<{ id: string; kind: string; entity_version: number; data: string; seq: number; updated_at: number; deleted_at: number | null }>;
    const cursor = rows.length > 0 ? rows[rows.length - 1]!.seq : 0;
    return {
      cursor,
      entities: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        entityVersion: r.entity_version,
        data: JSON.parse(r.data),
        seq: r.seq,
        updatedAt: r.updated_at,
        ...(r.deleted_at !== null ? { deletedAt: r.deleted_at } : {}),
      })),
    };
  });

  app.get("/v1/projects/:projectId/domain/delta", { preHandler: guard }, async (request, reply) => {
    const user = (request as unknown as AuthedRequest).user;
    const { projectId } = request.params as { projectId: string };
    const since = Number((request.query as { since?: string }).since ?? "0") || 0;
    const ownerError = projectOwnerError(db, user.userId, projectId);
    if (ownerError) return reply.code(ownerError.status).send({ code: ownerError.code, message: "项目不存在或无权访问" });
    const rows = db
      .prepare("SELECT id, kind, entity_version, data, seq, updated_at, deleted_at FROM domain_entities WHERE project_id = ? AND seq > ? ORDER BY seq")
      .all(projectId, since) as Array<{ id: string; kind: string; entity_version: number; data: string; seq: number; updated_at: number; deleted_at: number | null }>;
    const cursorRow = db
      .prepare("SELECT COALESCE(MAX(seq), ?) AS maxSeq FROM domain_entities WHERE project_id = ?")
      .get(since, projectId) as { maxSeq: number };
    return {
      cursor: cursorRow.maxSeq,
      entities: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        entityVersion: r.entity_version,
        data: JSON.parse(r.data),
        seq: r.seq,
        updatedAt: r.updated_at,
        ...(r.deleted_at !== null ? { deletedAt: r.deleted_at } : {}),
      })),
    };
  });

  app.post("/v1/projects/:projectId/domain/mutate", { preHandler: guard }, async (request, reply) => {
    const user = (request as unknown as AuthedRequest).user;
    const { projectId } = request.params as { projectId: string };
    const body = request.body as { conversationId?: string; leaseToken?: string; mutations?: DomainEntityMutation[] };
    const mutations = body?.mutations;
    if (!Array.isArray(mutations) || mutations.length === 0 || mutations.length > 64) {
      return reply.code(400).send({ code: "bad_mutation", message: "mutations 需为 1-64 项的数组" });
    }
    for (const m of mutations) {
      if (typeof m?.id !== "string" || m.id.length === 0 || m.id.length > 128) {
        return reply.code(400).send({ code: "bad_mutation", message: "实体 id 需 1-128 字符" });
      }
      if (typeof m.kind !== "string" || !KIND_PATTERN.test(m.kind)) {
        return reply.code(400).send({ code: "bad_mutation", message: `kind 非法: ${String(m.kind)}` });
      }
      if (m.op !== "put" && m.op !== "delete") {
        return reply.code(400).send({ code: "bad_mutation", message: "op 必须是 put|delete" });
      }
    }
    const ownerError = projectOwnerError(db, user.userId, projectId);
    if (ownerError) return reply.code(ownerError.status).send({ code: ownerError.code, message: "项目不存在或无权访问" });

    // 域写发生在某会话的 run 内 → 必须持有该会话租约（对齐 paragraphs/mutate）
    const lease = checkLease(db, body.conversationId ?? "", body.leaseToken, user.userId);
    if (!lease.ok) {
      const status = lease.code === "lease_required" ? 400 : lease.code === "lease_taken" ? 423 : 410;
      return reply.code(status).send({ code: lease.code, message: "无有效租约" });
    }

    const now = Date.now();
    const results: Array<{ id: string; kind: string; entityVersion?: number }> = [];
    try {
      const seq = db.transaction((): number => {
        let nextSeq = (
          db.prepare("SELECT COALESCE(MAX(seq), 0) AS m FROM domain_entities WHERE project_id = ?").get(projectId) as { m: number }
        ).m;
        for (const m of mutations) {
          nextSeq += 1;
          const existing = db
            .prepare("SELECT entity_version, deleted_at FROM domain_entities WHERE project_id = ? AND kind = ? AND id = ?")
            .get(projectId, m.kind, m.id) as { entity_version: number; deleted_at: number | null } | undefined;
          if (m.op === "put") {
            if (existing && existing.deleted_at === null) {
              if (m.baseVersion === undefined) throw new Conflict(existing.entity_version);
              const changes = db
                .prepare(
                  `UPDATE domain_entities SET data = ?, entity_version = entity_version + 1, seq = ?, updated_at = ?, deleted_at = NULL
                   WHERE project_id = ? AND kind = ? AND id = ? AND entity_version = ?`
                )
                .run(JSON.stringify(m.data ?? {}), nextSeq, now, projectId, m.kind, m.id, m.baseVersion);
              if (changes.changes === 0) throw new Conflict(existing.entity_version);
              results.push({ id: m.id, kind: m.kind, entityVersion: existing.entity_version + 1 });
            } else {
              // 不存在或已软删 → 新建（v1）；带 baseVersion 视为冲突（对齐 paragraphs 语义）
              if (m.baseVersion !== undefined) throw new Conflict(0, "实体不存在，不应携带 baseVersion");
              db.prepare(
                `INSERT INTO domain_entities (id, project_id, kind, entity_version, data, seq, updated_at, deleted_at)
                 VALUES (?, ?, ?, 1, ?, ?, ?, NULL)
                 ON CONFLICT (project_id, kind, id) DO UPDATE SET data = excluded.data, entity_version = 1, seq = excluded.seq, updated_at = excluded.updated_at, deleted_at = NULL`
              ).run(m.id, projectId, m.kind, JSON.stringify(m.data ?? {}), nextSeq, now);
              results.push({ id: m.id, kind: m.kind, entityVersion: 1 });
            }
          } else {
            if (m.baseVersion === undefined) throw new Conflict(existing?.entity_version ?? 0, "delete 需要 baseVersion");
            if (!existing || existing.deleted_at !== null) {
              throw new Conflict(existing?.entity_version ?? 0, "实体不存在");
            }
            const changes = db
              .prepare(
                `UPDATE domain_entities SET entity_version = entity_version + 1, seq = ?, updated_at = ?, deleted_at = ?
                 WHERE project_id = ? AND kind = ? AND id = ? AND entity_version = ?`
              )
              .run(nextSeq, now, now, projectId, m.kind, m.id, m.baseVersion);
            if (changes.changes === 0) throw new Conflict(existing.entity_version);
            results.push({ id: m.id, kind: m.kind });
          }
        }
        touchProjectActivity(db, projectId, now);
        // 同事务记账：域变更是事件流的一部分
        return appendLedgerRow(db, body.conversationId ?? "", -1, "domain-mutation", {
          mutations,
          actor: user.userId,
          results,
        });
      })();
      hub.publish({ type: "journal", conversationId: body.conversationId ?? "", seq, runSeq: -1, kind: "domain-mutation", payload: { mutations, results } });
      hub.publish({ type: "domain_changed", projectId, seq, count: mutations.length });
      return reply.send({ results, seq });
    } catch (e) {
      if (e instanceof Conflict) {
        return reply.code(409).send({ code: "stale_revision", currentVersion: e.currentVersion, message: e.message });
      }
      throw e;
    }
  });
}
