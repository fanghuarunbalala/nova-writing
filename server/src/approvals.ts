import type { FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import type { SseHub } from "./sse.js";
import { authGuard, type AuthedRequest } from "./auth.js";
import { checkLease } from "./lease.js";

/**
 * 审批队列两段式（PRD FR5）：征询落库（pending）→ SSE 广播 → 任意同账号设备 resolve → 广播决议。
 * 持久化修复桌面端 WaitRequestQueue 纯内存缺陷；「手机挂起、桌面批」由此成立。
 * NOVEL.md 提案：proposal {path, content} 随征询入库，approve 时由 server 落盘（任何路径不得静默改写）。
 */
export const APPROVAL_TIMEOUT_MS = 120_000;

interface ApprovalRow {
  id: number;
  request_id: string;
  conversation_id: string;
  run_seq: number;
  calls_json: string;
  status: string;
  comment: string | null;
  proposed_json: string | null;
  decided_by: string | null;
  created_at: number;
  decided_at: number | null;
}

/** 惰性过期：pending 超时未决 → expired。 */
function expireStale(db: Db, now = Date.now()): void {
  db.prepare(
    "UPDATE approvals SET status = 'expired', decided_at = ? WHERE status = 'pending' AND created_at + ? < ?"
  ).run(now, APPROVAL_TIMEOUT_MS, now);
}

export function listApprovals(db: Db, conversationId: string): ApprovalRow[] {
  expireStale(db);
  return db
    .prepare("SELECT * FROM approvals WHERE conversation_id = ? ORDER BY id")
    .all(conversationId) as ApprovalRow[];
}

export function registerApprovalRoutes(app: FastifyInstance, db: Db, hub: SseHub, secret: string): void {
  const guard = authGuard(secret);

  app.post("/v1/approvals", { preHandler: guard }, async (request, reply) => {
    const user = (request as unknown as AuthedRequest).user;
    const body = request.body as {
      conversationId?: string;
      runSeq?: number;
      requestId?: string;
      calls?: unknown[];
      proposal?: { projectId: string; path: string; content: string };
      leaseToken?: string;
    };
    if (!body?.conversationId || !body?.requestId || !Array.isArray(body?.calls)) {
      return reply.code(400).send({ code: "bad_request", message: "需要 conversationId/requestId/calls" });
    }
    const lease = checkLease(db, body.conversationId, body.leaseToken, user.userId);
    if (!lease.ok) {
      const status = lease.code === "lease_required" ? 400 : lease.code === "lease_taken" ? 423 : 410;
      return reply.code(status).send({ code: lease.code, message: "无有效租约" });
    }
    db.prepare(
      `INSERT INTO approvals (request_id, conversation_id, run_seq, calls_json, status, proposed_json, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)
       ON CONFLICT (request_id) DO NOTHING`
    ).run(body.requestId, body.conversationId, body.runSeq ?? 0, JSON.stringify(body.calls), body.proposal ? JSON.stringify(body.proposal) : null, Date.now());

    hub.publish({
      type: "approval_requested",
      conversationId: body.conversationId,
      requestId: body.requestId,
      runSeq: body.runSeq ?? 0,
      calls: body.calls,
      proposal: body.proposal ?? null,
    });
    return reply.code(201).send({ requestId: body.requestId, status: "pending" });
  });

  app.get("/v1/approvals", { preHandler: guard }, async (request) => {
    const query = request.query as { conversationId?: string };
    return { approvals: listApprovals(db, query.conversationId ?? "") };
  });

  app.post("/v1/approvals/:requestId/resolve", { preHandler: guard }, async (request, reply) => {
    const user = (request as unknown as AuthedRequest).user;
    const requestId = (request.params as { requestId: string }).requestId;
    const body = request.body as { decision?: "approve" | "reject"; comment?: string };
    if (body?.decision !== "approve" && body?.decision !== "reject") {
      return reply.code(400).send({ code: "bad_request", message: "decision 必须是 approve|reject" });
    }
    expireStale(db);
    const row = db.prepare("SELECT * FROM approvals WHERE request_id = ?").get(requestId) as
      | ApprovalRow
      | undefined;
    if (!row) return reply.code(404).send({ code: "not_found", message: "审批请求不存在" });
    if (row.status !== "pending") {
      return reply.code(409).send({ code: "already_decided", message: `该审批已处于 ${row.status}` });
    }
    // 提案文件（如 NOVEL.md）：approve 后由 server 落盘（唯一写入路径，任何 API 不得静默改写）
    if (body.decision === "approve" && row.proposed_json) {
      const proposal = JSON.parse(row.proposed_json) as { projectId: string; path: string; content: string };
      db.prepare(
        `INSERT INTO project_files (project_id, path, content, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (project_id, path) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`
      ).run(proposal.projectId, proposal.path, proposal.content, Date.now());
    }
    db.prepare(
      "UPDATE approvals SET status = ?, comment = ?, decided_by = ?, decided_at = ? WHERE request_id = ?"
    ).run(body.decision, body.comment ?? null, user.deviceId, Date.now(), requestId);

    hub.publish({
      type: "approval_resolved",
      conversationId: row.conversation_id,
      requestId,
      decision: body.decision,
      comment: body.comment ?? null,
      decidedBy: user.deviceId,
    });
    return reply.send({ requestId, status: body.decision });
  });
}
