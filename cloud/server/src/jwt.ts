import { SignJWT, jwtVerify } from "jose";

/**
 * JWT（HS256）：验签只算不查库——无状态，这是档位 3 多实例水平扩展的前提。
 * 代价：签发后到过期前无法吊销，所以 access TTL 压到 15 分钟（可吊销性由 refresh 承担）。
 */
export const ACCESS_TOKEN_TTL_SEC = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 天

export interface AccessClaims {
  sub: string; // userId
  did: string; // deviceId
}

export async function signAccessToken(secret: string, claims: AccessClaims): Promise<string> {
  return new SignJWT({ did: claims.did })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SEC}s`)
    .sign(new TextEncoder().encode(secret));
}

export async function verifyAccessToken(secret: string, token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    if (typeof payload.sub !== "string" || typeof payload.did !== "string") return null;
    return { sub: payload.sub, did: payload.did };
  } catch {
    return null;
  }
}
