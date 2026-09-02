import { hash, verify } from "@node-rs/argon2";
import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import { REFRESH_TOKEN_TTL_MS, signAccessToken, verifyAccessToken } from "./jwt.js";

/**
 * 认证模块（docs/PRD/认证-登录与多端会话.md）：
 * - Argon2id 密码哈希（内存困难，抗 GPU 暴破；每用户独立盐）
 * - 双令牌：JWT access（15min 无状态）+ refresh（DB 存 SHA-256 哈希、一次一换、复用检测吊销全族）
 * - 设备会话管理：设备列表 / 踢设备
 */

export interface AuthContext {
  userId: string;
  deviceId: string;
}

const ARGON2_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 }; // OWASP 推荐

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTS);
}

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  return verify(hashed, password, ARGON2_OPTS);
}

function newToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function uid(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}

/** 注册/登录共用的会话建立：建设备（或复用同名设备）+ 首个 refresh session。 */
function establishSession(db: Db, userId: string, deviceName: string, now: number) {
  const deviceId = uid("dev");
  db.prepare(
    "INSERT INTO devices (id, user_id, name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)"
  ).run(deviceId, userId, deviceName, now, now);

  const refreshToken = newToken();
  const familyId = uid("fam");
  db.prepare(
    `INSERT INTO sessions (id, family_id, user_id, device_id, refresh_hash, status, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
  ).run(uid("ses"), familyId, userId, deviceId, sha256(refreshToken), now, now + REFRESH_TOKEN_TTL_MS);
  return { deviceId, refreshToken, familyId };
}

export function registerAuthRoutes(app: FastifyInstance, db: Db, secret: string): void {
  /** 所有受保护路由的 JWT 校验装饰。 */
  app.decorateRequest("user", null);

  const insertSession = db.prepare(
    `INSERT INTO sessions (id, family_id, user_id, device_id, refresh_hash, status, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
  );

  app.post("/v1/auth/register", async (request, reply) => {
    const body = request.body as { username?: string; password?: string; deviceName?: string };
    const username = body?.username?.trim();
    const password = body?.password ?? "";
    const deviceName = body?.deviceName?.trim() || "未命名设备";
    if (!username || username.length < 3 || username.length > 32) {
      return reply.code(400).send({ code: "invalid_username", message: "用户名需 3-32 字符" });
    }
    if (password.length < 8) {
      return reply.code(400).send({ code: "weak_password", message: "密码至少 8 字符" });
    }
    const exists = db.prepare("SELECT 1 FROM users WHERE username = ?").get(username);
    if (exists) return reply.code(409).send({ code: "username_taken", message: "用户名已存在" });

    const now = Date.now();
    const userId = uid("usr");
    const passwordHash = await hashPassword(password);
    db.prepare(
      "INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)"
    ).run(userId, username, passwordHash, now);
    const session = establishSession(db, userId, deviceName, now);
    const accessToken = await signAccessToken(secret, { sub: userId, did: session.deviceId });
    return reply.code(201).send({
      userId,
      deviceId: session.deviceId,
      accessToken,
      refreshToken: session.refreshToken,
    });
  });

  app.post("/v1/auth/login", async (request, reply) => {
    const body = request.body as { username?: string; password?: string; deviceName?: string };
    const user = db.prepare("SELECT id, password_hash FROM users WHERE username = ?")
      .get(body?.username ?? "") as { id: string; password_hash: string } | undefined;
    // 防枚举：用户名不存在与密码错误返回同一文案
    const ok = user ? await verifyPassword(user.password_hash, body?.password ?? "") : false;
    if (!user || !ok) {
      return reply.code(401).send({ code: "invalid_credentials", message: "用户名或密码错误" });
    }
    const now = Date.now();
    const session = establishSession(db, user.id, body?.deviceName?.trim() || "未命名设备", now);
    const accessToken = await signAccessToken(secret, { sub: user.id, did: session.deviceId });
    db.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").run(now, session.deviceId);
    return reply.send({ userId: user.id, deviceId: session.deviceId, accessToken, refreshToken: session.refreshToken });
  });

  /** 刷新：一次一换 + 复用检测（呈现已轮换的旧 token = 泄露信号 → 吊销全族）。 */
  app.post("/v1/auth/refresh", async (request, reply) => {
    const body = request.body as { refreshToken?: string };
    const token = body?.refreshToken ?? "";
    const session = db.prepare("SELECT * FROM sessions WHERE refresh_hash = ?")
      .get(sha256(token)) as
      | { id: string; family_id: string; user_id: string; device_id: string; status: string; expires_at: number }
      | undefined;
    if (!session) return reply.code(401).send({ code: "invalid_token", message: "无效的刷新令牌" });
    if (session.status === "rotated") {
      db.prepare("UPDATE sessions SET status = 'revoked' WHERE family_id = ?").run(session.family_id);
      return reply.code(401).send({ code: "token_reuse_detected", message: "检测到刷新令牌复用，会话族已吊销" });
    }
    if (session.status === "revoked") {
      return reply.code(401).send({ code: "revoked", message: "会话已吊销" });
    }
    const now = Date.now();
    if (session.expires_at < now) {
      db.prepare("UPDATE sessions SET status = 'revoked' WHERE id = ?").run(session.id);
      return reply.code(401).send({ code: "expired", message: "会话已过期" });
    }
    // 轮换：旧 session 标 rotated（一次性），新 session 同族接棒
    db.prepare("UPDATE sessions SET status = 'rotated' WHERE id = ?").run(session.id);
    const refreshToken = newToken();
    insertSession.run(uid("ses"), session.family_id, session.user_id, session.device_id, sha256(refreshToken), now, now + REFRESH_TOKEN_TTL_MS);
    db.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").run(now, session.device_id);
    const accessToken = await signAccessToken(secret, { sub: session.user_id, did: session.device_id });
    return reply.send({ accessToken, refreshToken, deviceId: session.device_id, userId: session.user_id });
  });

  app.post("/v1/auth/logout", async (request, reply) => {
    const body = request.body as { refreshToken?: string };
    db.prepare("UPDATE sessions SET status = 'revoked' WHERE refresh_hash = ? AND status = 'active'")
      .run(sha256(body?.refreshToken ?? ""));
    return reply.code(204).send();
  });

  // ---- 以下需 JWT ----
  app.get("/v1/auth/devices", { preHandler: authGuard(secret) }, async (request) => {
    const user = (request as unknown as AuthedRequest).user;
    const devices = db.prepare(
      `SELECT d.id, d.name, d.created_at, d.last_seen_at,
              (SELECT COUNT(*) FROM sessions s WHERE s.device_id = d.id AND s.status = 'active') AS active_sessions
       FROM devices d WHERE d.user_id = ? ORDER BY d.last_seen_at DESC`
    ).all(user.userId) as Array<{ id: string; name: string; created_at: number; last_seen_at: number; active_sessions: number }>;
    return { devices };
  });

  app.delete("/v1/auth/devices/:id", { preHandler: authGuard(secret) }, async (request, reply) => {
    const user = (request as unknown as AuthedRequest).user;
    const deviceId = (request.params as { id: string }).id;
    const device = db.prepare("SELECT id FROM devices WHERE id = ? AND user_id = ?").get(deviceId, user.userId);
    if (!device) return reply.code(404).send({ code: "not_found", message: "设备不存在" });
    db.prepare("UPDATE sessions SET status = 'revoked' WHERE device_id = ? AND status != 'revoked'").run(deviceId);
    return reply.code(204).send();
  });
}

export interface AuthedRequest {
  user: AuthContext;
}

/** JWT 预处理器：验签失败 401；支持 header 或查询参数（SSE 用 EventSource 无法带 header，见 PRD 开放问题）。 */
export function authGuard(secret: string) {
  return async (request: any, reply: any) => {
    const header = request.headers?.authorization as string | undefined;
    const queryToken = request.query?.access_token as string | undefined;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : queryToken;
    const claims = token ? await verifyAccessToken(secret, token) : null;
    if (!claims) {
      return reply.code(401).send({ code: "unauthorized", message: "缺少或无效的访问令牌" });
    }
    request.user = { userId: claims.sub, deviceId: claims.did };
  };
}
