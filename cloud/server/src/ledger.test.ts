import { describe, expect, it } from "vitest";
import { acquireLease, auth, makeApp, registerUser } from "./test-util.js";

describe("事件账本", () => {
  it("上推需租约；seq 严格单调；重放返回全序", async () => {
    const { app } = await makeApp();
    const s = await registerUser(app, "ledger-user");

    // 无租约 → 400/423
    const noLease = await app.inject({
      method: "POST", url: "/v1/runs/conv-l/events", headers: auth(s),
      payload: { runSeq: 1, kind: "snapshot", messages: [{ type: "user", content: "hi" }] },
    });
    expect([400, 423]).toContain(noLease.statusCode);

    const lease = await acquireLease(app, s, "conv-l");
    const push = async (kind: string, messages: unknown[]) =>
      (
        await app.inject({
          method: "POST", url: "/v1/runs/conv-l/events", headers: auth(s),
          payload: { runSeq: 1, kind, messages, definitionVersion: "1.5.0", leaseToken: lease },
        })
      ).json() as any;

    const r1 = await push("snapshot", [{ type: "user", content: "第一条" }]);
    const r2 = await push("append", [{ type: "assistant", content: "回答" }]);
    expect(r2.seq).toBeGreaterThan(r1.seq);

    const replay = (
      await app.inject({ method: "GET", url: "/v1/journal/conv-l/replay", headers: auth(s) })
    ).json() as any;
    expect(replay.events).toHaveLength(2);
    expect(replay.events[0].payload).toContain("第一条");
    expect(replay.events[0].definition_version).toBe("1.5.0");
    expect(replay.events.map((e: any) => e.seq)).toEqual([r1.seq, r2.seq]);
  });

  it("跨用户重放 403", async () => {
    const { app } = await makeApp();
    const alice = await registerUser(app, "ledger-alice");
    await registerUser(app, "ledger-mallory", "M");
    const lease = await acquireLease(app, alice, "conv-private");
    await app.inject({
      method: "POST", url: "/v1/runs/conv-private/events", headers: auth(alice),
      payload: { runSeq: 1, kind: "snapshot", messages: [{ type: "user", content: "私密" }], leaseToken: lease },
    });
    const res = await app.inject({
      method: "GET", url: "/v1/journal/conv-private/replay",
      headers: auth(alice), // mallory 的 token
    });
    // 用 mallory 真实访问
    const mallory = (await app.inject({
      method: "POST", url: "/v1/auth/login",
      payload: { username: "ledger-mallory", password: "password123", deviceName: "M" },
    })).json() as any;
    const forbidden = await app.inject({
      method: "GET", url: "/v1/journal/conv-private/replay",
      headers: { authorization: `Bearer ${mallory.accessToken}` },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(res.statusCode).toBe(200);
  });
});
