import Fastify from "fastify";
import { openDb, type Db } from "./db.js";
import { authGuard, registerAuthRoutes, type AuthedRequest } from "./auth.js";
import { SseHub } from "./sse.js";
import { registerLeaseRoutes } from "./lease.js";
import { registerLedgerRoutes } from "./ledger.js";
import { registerDomainRoutes } from "./domain.js";
import { registerApprovalRoutes } from "./approvals.js";
import { registerMemoryRoutes, newProjectId } from "./memory.js";
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
  registerMemoryRoutes(app, db, hub, secret);

  // 项目路由（M1 owner-only）
  const guard = authGuard(secret);
  app.post("/v1/projects", { preHandler: guard }, async (request, reply) => {
    const user = (request as unknown as AuthedRequest).user;
    const body = request.body as { name?: string };
    const id = newProjectId();
    db.prepare("INSERT INTO projects (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)").run(
      id, user.userId, body?.name ?? "未命名项目", Date.now()
    );
    return reply.code(201).send({ id, name: body?.name ?? "未命名项目" });
  });

  app.get("/health", async () => ({ ok: true }));

  return { app, hub, db };
}
