import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import type { SseHub } from "./sse.js";
import { authGuard, type AuthedRequest } from "./auth.js";

/**
 * 租约仲裁（PRD 3.3 状态机）：一个会话同一时刻只有一个执行端。
 * 认证回答「你是谁」，租约回答「哪个设备在执行」——两层独立；
 * 心跳校验设备 session 有效性，被踢设备自动回收租约（无孤儿租约）。
 */
export const LEASE_TTL_MS = 60_000;

interface LeaseRow {
  conversation_id: string;
  user_id: string;
  device_id: string;
  token: string;
  expires_at: number;
}

export function getActiveLease(db: Db, conversationId: string, now = Date.now()): LeaseRow | undefined {
  const row = db.prepare("SELECT * FROM leases WHERE conversation_id = ?").get(conversationId) as
    | LeaseRow
    | undefined;
  if (!row) return undefined;
  if (row.expires_at < now) {
    db.prepare("DELETE FROM leases WHERE conversation_id = ?").run(conversationId);
    return undefined;
  }
  return row;
}

/** 校验租约：属于该会话、未过期、属于当前用户。失败返回错误码。 */
export function checkLease(
  db: Db,
  conversationId: string,
  leaseToken: string | undefined,
  userId: string,
  now = Date.now()
): { ok: true } | { ok: false; code: "lease_required" | "lease_taken" | "lease_expired" } {
  if (!leaseToken) return { ok: false, code: "lease_required" };
  const lease = getActiveLease(db, conversationId, now);
  if (!lease) return { ok: false, code: "lease_expired" };
  if (lease.user_id !== userId) return { ok: false, code: "lease_taken" };
  if (lease.token !== leaseToken) return { ok: false, code: "lease_taken" };
  return { ok: true };
}

export function registerLeaseRoutes(app: FastifyInstance, db: Db, hub: SseHub, secret: string): void {
  const guard = authGuard(secret);

  app.post("/v1/leases", { preHandler: guard }, async (request, reply) => {
    const user = (request as unknown as AuthedRequest).user;
    const body = request.body as { conversationId?: string };
    const conversationId = body?.conversationId;
    if (!conversationId) return reply.code(400).send({ code: "bad_request", message: "缺少 conversationId" });

    const now = Date.now();
    const existing = getActiveLease(db, conversationId, now);
    if (existing) {
      if (existing.user_id !== user.userId) {
        return reply.code(403).send({ code: "forbidden", message: "会话属于其他用户" });
      }
      if (existing.device_id === user.deviceId) {
        // 同设备续租：延长 TTL，token 不变
        db.prepare("UPDATE leases SET expires_at = ? WHERE conversation_id = ?").run(
          now + LEASE_TTL_MS,
          conversationId
        );
        return reply.send({ leaseToken: existing.token, expiresAt: now + LEASE_TTL_MS, renewed: true });
      }
      return reply.code(409).send({
        code: "lease_held",
        message: "会话正被其他设备执行",
        holderDeviceId: existing.device_id,
        expiresAt: existing.expires_at,
      });
    }
    const token = crypto.randomBytes(24).toString("base64url");
    db.prepare(
      `INSERT OR REPLACE INTO leases (conversation_id, user_id, device_id, token, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(conversationId, user.userId, user.deviceId, token, now + LEASE_TTL_MS, now);
    return reply.send({ leaseToken: token, expiresAt: now + LEASE_TTL_MS, renewed: false });
  });

  app.post("/v1/leases/:conversationId/heartbeat", { preHandler: guard }, async (request, reply) => {
    const user = (request as unknown as AuthedRequest).user;
    const conversationId = (request.params as { conversationId: string }).conversationId;
    const body = request.body as { leaseToken?: string };
    const now = Date.now();

    // 被踢设备的 session 全部 revoked → 自动回收租约
    const deviceAlive = db
      .prepare("SELECT 1 FROM sessions WHERE device_id = ? AND status = 'active' LIMIT 1")
      .get(user.deviceId);
    const lease = getActiveLease(db, conversationId, now);
    if (!deviceAlive && lease?.device_id === user.deviceId) {
      db.prepare("DELETE FROM leases WHERE conversation_id = ?").run(conversationId);
      hub.publish({ type: "lease_revoked", conversationId, reason: "device_revoked", deviceId: user.deviceId });
      return reply.code(410).send({ code: "device_revoked", message: "设备会话已被吊销，租约回收" });
    }
    if (!lease) return reply.code(410).send({ code: "lease_expired", message: "租约已失效" });
    if (lease.token !== body?.leaseToken) {
      return reply.code(410).send({ code: "lease_taken", message: "租约已被其他设备取得" });
    }
    db.prepare("UPDATE leases SET expires_at = ? WHERE conversation_id = ?").run(now + LEASE_TTL_MS, conversationId);
    return reply.send({ expiresAt: now + LEASE_TTL_MS });
  });

  app.delete("/v1/leases/:conversationId", { preHandler: guard }, async (request, reply) => {
    const user = (request as unknown as AuthedRequest).user;
    const conversationId = (request.params as { conversationId: string }).conversationId;
    const body = request.body as { leaseToken?: string };
    const lease = db.prepare("SELECT * FROM leases WHERE conversation_id = ?").get(conversationId) as
      | LeaseRow
      | undefined;
    if (lease && lease.user_id === user.userId && lease.token === body?.leaseToken) {
      db.prepare("DELETE FROM leases WHERE conversation_id = ?").run(conversationId);
      hub.publish({ type: "lease_released", conversationId, deviceId: lease.device_id });
    }
    return reply.code(204).send();
  });
}
