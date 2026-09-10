import { describe, expect, it } from "vitest";
import { auth, loginUser, makeApp, registerUser } from "./test-util.js";

describe("认证", () => {
  it("注册 → 受保护接口 401/200 → 登录", async () => {
    const { app } = await makeApp();
    const noAuth = await app.inject({ method: "GET", url: "/v1/auth/devices" });
    expect(noAuth.statusCode).toBe(401);

    const s = await registerUser(app, "alice");
    expect(s.accessToken).toBeTruthy();
    expect(s.deviceId).toBeTruthy();

    const ok = await app.inject({ method: "GET", url: "/v1/auth/devices", headers: auth(s) });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as any).devices).toHaveLength(1);

    const s2 = await loginUser(app, "alice", "第二台设备");
    const list = (await app.inject({ method: "GET", url: "/v1/auth/devices", headers: auth(s2) })).json() as any;
    expect(list.devices).toHaveLength(2);
  });

  it("防用户名枚举：不存在与密码错误返回同一文案", async () => {
    const { app } = await makeApp();
    await registerUser(app, "bob");
    const wrongUser = await app.inject({
      method: "POST", url: "/v1/auth/login",
      payload: { username: "no-such-user", password: "password123" },
    });
    const wrongPass = await app.inject({
      method: "POST", url: "/v1/auth/login",
      payload: { username: "bob", password: "wrong-password" },
    });
    expect(wrongUser.statusCode).toBe(wrongPass.statusCode);
    expect(wrongUser.json()).toEqual(wrongPass.json());
  });

  it("刷新轮换：旧 refresh 复用 → 吊销全族", async () => {
    const { app } = await makeApp();
    const s = await registerUser(app, "carol");

    // 第一次刷新：成功且换新
    const r1 = await app.inject({
      method: "POST", url: "/v1/auth/refresh", payload: { refreshToken: s.refreshToken },
    });
    expect(r1.statusCode).toBe(200);
    const pair1 = r1.json() as any;
    expect(pair1.refreshToken).not.toBe(s.refreshToken);

    // 复用旧 token（泄露信号）→ 401 + 全族吊销
    const r2 = await app.inject({
      method: "POST", url: "/v1/auth/refresh", payload: { refreshToken: s.refreshToken },
    });
    expect(r2.statusCode).toBe(401);
    expect((r2.json() as any).code).toBe("token_reuse_detected");

    // 新 token 也随族被吊销
    const r3 = await app.inject({
      method: "POST", url: "/v1/auth/refresh", payload: { refreshToken: pair1.refreshToken },
    });
    expect(r3.statusCode).toBe(401);
  });

  it("登出吊销 refresh；踢设备吊销该设备全部 session", async () => {
    const { app } = await makeApp();
    const s = await registerUser(app, "dave", "手机");
    const other = await loginUser(app, "dave", "电脑");

    await app.inject({ method: "POST", url: "/v1/auth/logout", payload: { refreshToken: s.refreshToken } });
    const revoked = await app.inject({
      method: "POST", url: "/v1/auth/refresh", payload: { refreshToken: s.refreshToken },
    });
    expect(revoked.statusCode).toBe(401);

    // 用电脑踢掉手机
    const kick = await app.inject({ method: "DELETE", url: `/v1/auth/devices/${s.deviceId}`, headers: auth(other) });
    expect(kick.statusCode).toBe(204);
    const list = (await app.inject({ method: "GET", url: "/v1/auth/devices", headers: auth(other) })).json() as any;
    expect(list.devices.find((d: any) => d.id === s.deviceId).active_sessions).toBe(0);
  });

  it("注册校验：弱密码/重名", async () => {
    const { app } = await makeApp();
    const weak = await app.inject({
      method: "POST", url: "/v1/auth/register",
      payload: { username: "erin", password: "short" },
    });
    expect(weak.statusCode).toBe(400);
    await registerUser(app, "erin");
    const dup = await app.inject({
      method: "POST", url: "/v1/auth/register",
      payload: { username: "erin", password: "password123" },
    });
    expect(dup.statusCode).toBe(409);
  });
});
