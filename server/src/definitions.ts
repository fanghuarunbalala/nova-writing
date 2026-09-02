import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import { authGuard, type AuthedRequest } from "./auth.js";

/**
 * 定义包存储与分发 + 能力协商（docs/PRD/定义包-agent策略统一.md FR2）：
 * - 不可变：definitionVersion 主键，同版本重复上传 409；内容 sha256 寻址（ETag）。
 * - resolve：端携带能力声明（支持的 rendererId/policyId/nudgeId/groupId），
 *   server 返回该端【能装配的最新包】——不是每端一个专属包，而是一条版本线按能力取最新。
 */
interface DefinitionRow {
  definition_version: string;
  agent_type: string;
  content: string;
  sha256: string;
  requires_json: string;
  created_at: number;
}

interface BundleShape {
  definitionVersion?: string;
  agentType?: string;
  prompt?: { recipe?: Array<{ kind?: string; rendererId?: string }> };
  tools?: { groups?: Array<{ groupId?: string }> };
  nudges?: Array<{ nudgeId?: string }>;
  compact?: { chain?: Array<{ policyId?: string }> };
}

interface Requirements {
  renderers: string[];
  policies: string[];
  triggers: string[];
  toolGroups: string[];
}

/** 从包内容推导需求清单（能力协商依据）。 */
export function deriveRequirementsFromBundle(bundle: BundleShape): Requirements {
  return {
    renderers: (bundle.prompt?.recipe ?? [])
      .filter((i) => i.kind === "dynamic" && typeof i.rendererId === "string")
      .map((i) => i.rendererId as string),
    policies: (bundle.compact?.chain ?? [])
      .map((p) => p.policyId)
      .filter((p): p is string => typeof p === "string"),
    triggers: (bundle.nudges ?? [])
      .map((n) => n.nudgeId)
      .filter((n): n is string => typeof n === "string"),
    toolGroups: (bundle.tools?.groups ?? [])
      .map((g) => g.groupId)
      .filter((g): g is string => typeof g === "string"),
  };
}

function semverKey(v: string): number[] {
  return v.split(".").map((x) => Number(x) || 0);
}

function newer(a: string, b: string): boolean {
  const ka = semverKey(a);
  const kb = semverKey(b);
  for (let i = 0; i < 3; i++) {
    if ((ka[i] ?? 0) !== (kb[i] ?? 0)) return (ka[i] ?? 0) > (kb[i] ?? 0);
  }
  return false;
}

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

export function registerDefinitionRoutes(app: FastifyInstance, db: Db, secret: string): void {
  const guard = authGuard(secret);

  app.post("/v1/definitions", { preHandler: guard }, async (request, reply) => {
    const bundle = request.body as BundleShape;
    const version = bundle?.definitionVersion;
    if (!version || !SEMVER_RE.test(version)) {
      return reply.code(400).send({ code: "bad_version", message: "definitionVersion 必须是 x.y.z" });
    }
    if (typeof bundle.agentType !== "string" || !bundle.prompt || !bundle.compact) {
      return reply.code(400).send({ code: "bad_bundle", message: "包结构不完整（agentType/prompt/compact）" });
    }
    const content = JSON.stringify(bundle);
    const requires = deriveRequirementsFromBundle(bundle);
    const exists = db.prepare("SELECT 1 FROM definitions WHERE definition_version = ?").get(version);
    if (exists) {
      // 不可变：同版本已存在 → 409（内容相同也拒绝，提示用新版本号）
      return reply.code(409).send({ code: "version_exists", message: `定义包 ${version} 已存在（不可变）` });
    }
    db.prepare(
      `INSERT INTO definitions (definition_version, agent_type, content, sha256, requires_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(version, bundle.agentType, content, crypto.createHash("sha256").update(content).digest("hex"), JSON.stringify(requires), Date.now());
    return reply.code(201).send({ definitionVersion: version, sha256: requires });
  });

  app.get("/v1/definitions/:version", { preHandler: guard }, async (request, reply) => {
    const version = (request.params as { version: string }).version;
    const row = db.prepare("SELECT * FROM definitions WHERE definition_version = ?").get(version) as
      | DefinitionRow
      | undefined;
    if (!row) return reply.code(404).send({ code: "not_found", message: `定义包 ${version} 不存在` });
    const etag = `"${row.sha256.slice(0, 32)}"`;
    if (request.headers["if-none-match"] === etag) {
      return reply.code(304).send();
    }
    return reply
      .header("etag", etag)
      .send({ bundle: JSON.parse(row.content), requirements: JSON.parse(row.requires_json) });
  });

  /** 能力协商：给定端能力，返回能装配的最新包。 */
  app.post("/v1/definitions/resolve", { preHandler: guard }, async (request, reply) => {
    const body = request.body as {
      agentType?: string;
      capabilities?: { renderers?: string[]; policies?: string[]; triggers?: string[]; toolGroups?: string[] };
    };
    const agentType = body?.agentType ?? "novel";
    const caps = body?.capabilities ?? {};
    const capRenderers = new Set(caps.renderers ?? []);
    const capPolicies = new Set(caps.policies ?? []);
    const capTriggers = new Set(caps.triggers ?? []);
    const capGroups = new Set(caps.toolGroups ?? []);

    const rows = db
      .prepare("SELECT * FROM definitions WHERE agent_type = ? ORDER BY created_at")
      .all(agentType) as DefinitionRow[];
    const compatible = rows.filter((row) => {
      const req = JSON.parse(row.requires_json) as Requirements;
      return (
        req.renderers.every((r) => capRenderers.has(r)) &&
        req.policies.every((p) => capPolicies.has(p)) &&
        req.triggers.every((t) => capTriggers.has(t)) &&
        req.toolGroups.every((g) => capGroups.has(g))
      );
    });
    if (compatible.length === 0) {
      return reply.code(404).send({
        code: "no_compatible_definition",
        message: "当前端能力无法装配任何已发布定义包（请升级 App）",
      });
    }
    // 最新兼容版（semver 最大）
    const newest = compatible.reduce((a, b) => (newer(b.definition_version, a.definition_version) ? b : a));
    return reply.send({
      bundle: JSON.parse(newest.content),
      requirements: JSON.parse(newest.requires_json),
      etag: `"${newest.sha256.slice(0, 32)}"`,
    });
  });
}
