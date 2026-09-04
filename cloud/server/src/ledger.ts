import type { FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import type { SseHub } from "./sse.js";
import { authGuard, type AuthedRequest } from "./auth.js";
import { checkLease } from "./lease.js";

/**
 * 事件账本（PRD FR1/FR2）：append-only、自增 seq = 权威全序。
 * 上推需 JWT + 有效租约；SSE 先推积压（since 游标）再推实时——副本滞后/断线重连天然无害（重放幂等）。
 */
export interface JournalRow {
  seq: number;
  conversation_id: string;
  run_seq: number;
  kind: string;
  payload: string;
  definition_version: string | null;
  created_at: number;
}

export function appendLedgerRow(
  db: Db,
  conversationId: string,
  runSeq: number,
  kind: string,
  payload: unknown,
  definitionVersion?: string | null
): number {
  const info = db
    .prepare(
      `INSERT INTO journal_events (conversation_id, run_seq, kind, payload, definition_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(conversationId, runSeq, kind, JSON.stringify(payload), definitionVersion ?? null, Date.now());
  return Number(info.lastInsertRowid);
}

export function registerLedgerRoutes(app: FastifyInstance, db: Db, hub: SseHub, secret: string): void {
  const guard = authGuard(secret);

  app.post("/v1/runs/:conversationId/events", { preHandler: guard }, async (request, reply) => {
    const user = (request as unknown as AuthedRequest).user;
    const conversationId = (request.params as { conversationId: string }).conversationId;
    const body = request.body as {
      runSeq?: number;
      kind?: string;
      messages?: unknown[];
      definitionVersion?: string;
      leaseToken?: string;
    };
    if (typeof body?.runSeq !== "number" || !Array.isArray(body?.messages)) {
      return reply.code(400).send({ code: "bad_request", message: "需要 runSeq 与 messages 数组" });
    }
    if (body.kind !== "snapshot" && body.kind !== "append") {
      return reply.code(400).send({ code: "bad_request", message: "kind 必须是 snapshot|append" });
    }
    const lease = checkLease(db, conversationId, body.leaseToken, user.userId);
    if (!lease.ok) {
      const status = lease.code === "lease_required" ? 400 : lease.code === "lease_taken" ? 423 : 410;
      return reply.code(status).send({ code: lease.code, message: "无有效租约" });
    }
    const seq = appendLedgerRow(db, conversationId, body.runSeq, body.kind, body.messages, body.definitionVersion);
    hub.publish({
      type: "journal",
      conversationId,
      seq,
      runSeq: body.runSeq,
      kind: body.kind,
      payload: body.messages,
      definitionVersion: body.definitionVersion ?? null,
    });
    return reply.code(201).send({ seq });
  });

  /**
   * 全量重写（压缩/清空后的 writeRuns 上推；PRD 桌面接入 FR2，开放问题①敲定：PUT 原子语义）。
   * 乐观校验 expectedLastSeq：与当前最大 seq 不符 = 并发覆盖风险 → 409 附当前值（客户端重放后重试）。
   * 事务内 delete 全部旧行 + 逐 run 插 snapshot 行；SSE 广播 journal_rewritten（订阅者应整体重放）。
   */
  app.put("/v1/journal/:conversationId/rewrite", { preHandler: guard }, async (request, reply) => {
    const user = (request as unknown as AuthedRequest).user;
    const conversationId = (request.params as { conversationId: string }).conversationId;
    const body = request.body as {
      expectedLastSeq?: number;
      leaseToken?: string;
      runs?: Array<{ runSeq?: number; messages?: unknown[] }>;
    };
    if (typeof body?.expectedLastSeq !== "number" || !Array.isArray(body?.runs)) {
      return reply.code(400).send({ code: "bad_request", message: "需要 expectedLastSeq 与 runs 数组" });
    }
    for (const run of body.runs) {
      if (typeof run?.runSeq !== "number" || !Array.isArray(run?.messages)) {
        return reply.code(400).send({ code: "bad_request", message: "runs[] 每项需要 runSeq 与 messages" });
      }
    }
    const lease = checkLease(db, conversationId, body.leaseToken, user.userId);
    if (!lease.ok) {
      const status = lease.code === "lease_required" ? 400 : lease.code === "lease_taken" ? 423 : 410;
      return reply.code(status).send({ code: lease.code, message: "无有效租约" });
    }
    const result = db.transaction(() => {
      const current = db
        .prepare("SELECT MAX(seq) AS maxSeq FROM journal_events WHERE conversation_id = ?")
        .get(conversationId) as { maxSeq: number | null };
      if ((current.maxSeq ?? 0) !== body.expectedLastSeq) {
        return { conflict: true, currentLastSeq: current.maxSeq ?? 0 };
      }
      db.prepare("DELETE FROM journal_events WHERE conversation_id = ?").run(conversationId);
      let lastSeq = 0;
      for (const run of body.runs!) {
        lastSeq = appendLedgerRow(db, conversationId, run.runSeq!, "snapshot", run.messages!);
      }
      return { conflict: false as const, lastSeq };
    })();
    if (result.conflict) {
      return reply.code(409).send({ code: "stale_rewrite", message: "账本已被并发写入，请重放后重试", currentLastSeq: result.currentLastSeq });
    }
    hub.publish({ type: "journal_rewritten", conversationId, lastSeq: result.lastSeq, runCount: body.runs!.length });
    return reply.send({ lastSeq: result.lastSeq });
  });

  /**
   * 账本重放（纯云端化 FR1）：`?since=` 增量（只回 seq > since，本地镜像回放省流量；
   * 缺省 0 = 全量，向后兼容）。响应附 `lastSeq`（该会话当前最大 seq）——客户端据此判定
   * 「账本被 rewrite 收缩」（lastSeq < 本地尾序 → 需全量重建本地镜像）。
   */
  app.get("/v1/journal/:conversationId/replay", { preHandler: guard }, async (request, reply) => {
    const user = (request as unknown as AuthedRequest).user;
    const conversationId = (request.params as { conversationId: string }).conversationId;
    const since = Number((request.query as { since?: string }).since ?? "0") || 0;
    const events = db
      .prepare("SELECT * FROM journal_events WHERE conversation_id = ? AND seq > ? ORDER BY seq")
      .all(conversationId, since) as JournalRow[];
    // owner-only（M1 简化）：会话归属由租约历史隐式约束——曾持有过该会话租约的用户可见
    //（存在性用未过滤查询判定——since 增量把行滤空时不能放行非 owner 探测）
    const ownerIds = new Set(
      (
        db
          .prepare("SELECT DISTINCT user_id AS uid FROM leases WHERE conversation_id = ?")
          .all(conversationId) as Array<{ uid: string }>
      ).map((r) => r.uid)
    );
    const hasAny = db
      .prepare("SELECT 1 AS one FROM journal_events WHERE conversation_id = ? LIMIT 1")
      .get(conversationId);
    if (hasAny !== undefined && ownerIds.size > 0 && !ownerIds.has(user.userId)) {
      return reply.code(403).send({ code: "forbidden", message: "会话属于其他用户" });
    }
    const lastSeqRow = db
      .prepare("SELECT MAX(seq) AS maxSeq FROM journal_events WHERE conversation_id = ?")
      .get(conversationId) as { maxSeq: number | null };
    return reply.send({ events, lastSeq: lastSeqRow.maxSeq ?? 0 });
  });

  /** SSE：先积压后实时（since 游标幂等补拉），15s 心跳注释行防中间件断连。 */
  app.get("/v1/events", { preHandler: guard }, async (request, reply) => {
    const query = request.query as { conversationId?: string; since?: string };
    const conversationId = query.conversationId;
    const since = Number(query.since ?? "0") || 0;
    const user = (request as unknown as AuthedRequest).user;

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    const write = (obj: unknown) => reply.raw.write(`data: ${JSON.stringify(obj)}\n\n`);
    // 积压
    const backlog = db
      .prepare("SELECT * FROM journal_events WHERE conversation_id = ? AND seq > ? ORDER BY seq")
      .all(conversationId ?? "", since) as JournalRow[];
    for (const row of backlog) {
      write({
        type: "journal",
        conversationId: row.conversation_id,
        seq: row.seq,
        runSeq: row.run_seq,
        kind: row.kind,
        payload: JSON.parse(row.payload),
        definitionVersion: row.definition_version,
      });
    }
    write({ type: "ready", conversationId: conversationId ?? null, userId: user.userId, backlog: backlog.length });

    const unsubscribe = hub.subscribe((event) => {
      if (conversationId && event.conversationId !== conversationId) return;
      write(event);
    });
    const heartbeat = setInterval(() => reply.raw.write(`: heartbeat\n\n`), 15_000);
    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
    // 保持连接打开：不调用 reply.send，由 close 事件收尾
    await new Promise<void>(() => {});
  });
}
