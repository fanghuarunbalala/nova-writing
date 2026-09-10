import Fastify from "fastify";
import { openDb, type Db } from "./db.js";
import { authGuard, registerAuthRoutes, type AuthedRequest } from "./auth.js";
import { SseHub } from "./sse.js";
import { registerLeaseRoutes } from "./lease.js";
import { registerLedgerRoutes } from "./ledger.js";
import { registerDomainRoutes } from "./domain.js";
import { registerApprovalRoutes } from "./approvals.js";
import { registerFileRoutes, newProjectId } from "./files.js";
import { registerProjectRoutes } from "./projects.js";
import { registerDefinitionRoutes } from "./definitions.js";
import type { FastifyInstance } from "fastify";

export interface BuildOptions {
  db?: Db;
  secret?: string;
}

export async function buildServer(opts: BuildOptions = {}): Promise<{ app: FastifyInstance; hub: SseHub; db: Db }> {
  const db = opts.db ?? openDb(":memory:");
  const secret = opts.secret ?? process.env.NOVA_SERVER_SECRET ?? "dev-secret-change-me";
  const hub = new SseHub();
  const app = Fastify({ logger: false, bodyLimit: 16 * 1024 * 1024 });

  registerAuthRoutes(app, db, secret);
  registerLeaseRoutes(app, db, hub, secret);
  registerLedgerRoutes(app, db, hub, secret);
  registerDomainRoutes(app, db, hub, secret);
  registerApprovalRoutes(app, db, hub, secret);
  registerFileRoutes(app, db, hub, secret);
  registerProjectRoutes(app, db, secret);
  registerDefinitionRoutes(app, db, secret);

  // 建项目（M1 owner-only；云项目 = 权威实体，无本地目录——项目域上云 PRD）
  const guard = authGuard(secret);
  app.post("/v1/projects", { preHandler: guard }, async (request, reply) => {
    const user = (request as unknown as AuthedRequest).user;
    const body = request.body as { name?: string };
    const name = body?.name?.trim() || "未命名项目";
    if (name.length > 64) return reply.code(400).send({ code: "bad_name", message: "项目名需 1 – 64 字符" });
    const id = newProjectId();
    const now = Date.now();
    db.prepare(
      "INSERT INTO projects (id, owner_id, name, created_at, last_activity_at) VALUES (?, ?, ?, ?, ?)"
    ).run(id, user.userId, name, now, now);
    return reply.code(201).send({ id, name });
  });

  app.get("/health", async () => ({ ok: true }));

  return { app, hub, db };
}
