import { describe, expect, it } from "vitest";
import { acquireLease, auth, loginUser, makeApp, registerUser } from "./test-util.js";

describe("租约仲裁", () => {
  it("互斥：其他设备申请 409（附持有者信息）；同设备续租", async () => {
    const { app } = await makeApp();
    const phone = await registerUser(app, "frank", "手机");
    const pc = await loginUser(app, "frank", "电脑");

    const token = await acquireLease(app, phone, "conv-1");
    expect(token).toBeTruthy();

    const conflict = await app.inject({
      method: "POST", url: "/v1/leases", headers: auth(pc), payload: { conversationId: "conv-1" },
    });
    expect(conflict.statusCode).toBe(409);
    const body = conflict.json() as any;
    expect(body.holderDeviceId).toBe(phone.deviceId);

    // 同设备再次申请 = 续租，token 不变
    const renew = await app.inject({
      method: "POST", url: "/v1/leases", headers: auth(phone), payload: { conversationId: "conv-1" },
    });
    expect(renew.statusCode).toBe(200);
    expect((renew.json() as any).leaseToken).toBe(token);
    expect((renew.json() as any).renewed).toBe(true);
  });

  it("释放后其他设备可接管", async () => {
    const { app } = await makeApp();
    const a = await registerUser(app, "grace", "A设备");
    const b = await loginUser(app, "grace", "B设备");
    const tokenA = await acquireLease(app, a, "conv-2");

    await app.inject({
      method: "DELETE", url: "/v1/leases/conv-2", headers: auth(a), payload: { leaseToken: tokenA },
    });
    const tokenB = await acquireLease(app, b, "conv-2");
    expect(tokenB).not.toBe(tokenA);

    // 旧 token 心跳 → 410（已被接管）
    const staleHeartbeat = await app.inject({
      method: "POST", url: "/v1/leases/conv-2/heartbeat", headers: auth(a), payload: { leaseToken: tokenA },
    });
    expect(staleHeartbeat.statusCode).toBe(410);
  });

  it("设备被踢后心跳触发租约自动回收", async () => {
    const { app } = await makeApp();
    const phone = await registerUser(app, "heidi", "手机");
    const pc = await loginUser(app, "heidi", "电脑");
    const token = await acquireLease(app, phone, "conv-3");

    await app.inject({ method: "DELETE", url: `/v1/auth/devices/${phone.deviceId}`, headers: auth(pc) });

    const heartbeat = await app.inject({
      method: "POST", url: "/v1/leases/conv-3/heartbeat", headers: auth(phone), payload: { leaseToken: token },
    });
    expect(heartbeat.statusCode).toBe(410);
    expect((heartbeat.json() as any).code).toBe("device_revoked");

    // 租约已回收：电脑可以直接申请
    const tokenPc = await acquireLease(app, pc, "conv-3");
    expect(tokenPc).toBeTruthy();
  });

  it("租约过期后可被重新申请（模拟时钟推进）", async () => {
    const { app, db } = await makeApp();
    const a = await registerUser(app, "ivan", "A");
    const b = await loginUser(app, "ivan", "B");
    await acquireLease(app, a, "conv-4");
    // 直接把租约过期（绕过真实等待 60s）
    db.prepare("UPDATE leases SET expires_at = ? WHERE conversation_id = ?").run(Date.now() - 1, "conv-4");
    const tokenB = await acquireLease(app, b, "conv-4");
    expect(tokenB).toBeTruthy();
  });

  it("跨用户会话互不可见：另一用户申请同一 conversationId 得 403", async () => {
    const { app } = await makeApp();
    const alice = await registerUser(app, "alice9", "A");
    const mallory = await registerUser(app, "mallory9", "M");
    await acquireLease(app, alice, "conv-x");
    const res = await app.inject({
      method: "POST", url: "/v1/leases", headers: auth(mallory), payload: { conversationId: "conv-x" },
    });
    expect(res.statusCode).toBe(403);
  });
});
