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

  it("rewrite：全量重写替换旧行；expectedLastSeq 不符 409 附当前值", async () => {
    const { app } = await makeApp();
    const s = await registerUser(app, "rewrite-user");
    const lease = await acquireLease(app, s, "conv-rw");
    const push = (messages: unknown[]) =>
      app.inject({
        method: "POST", url: "/v1/runs/conv-rw/events", headers: auth(s),
        payload: { runSeq: 1, kind: "append", messages, leaseToken: lease },
      });
    const r1 = await (await push([{ type: "user", content: "旧内容1" }])).json();
    const r2 = await (await push([{ type: "user", content: "旧内容2" }])).json();

    // 过期 expectedLastSeq → 409 + currentLastSeq
    const stale = await app.inject({
      method: "PUT", url: "/v1/journal/conv-rw/rewrite", headers: auth(s),
      payload: { expectedLastSeq: r1.seq, leaseToken: lease, runs: [{ runSeq: 1, messages: [] }] },
    });
    expect(stale.statusCode).toBe(409);
    expect((stale.json() as any).currentLastSeq).toBe(r2.seq);

    // 匹配 → 行替换为压缩后的 snapshot
    const ok = await app.inject({
      method: "PUT", url: "/v1/journal/conv-rw/rewrite", headers: auth(s),
      payload: {
        expectedLastSeq: r2.seq, leaseToken: lease,
        runs: [
          { runSeq: 1, messages: [{ type: "user", content: "压缩摘要" }] },
          { runSeq: 2, messages: [{ type: "user", content: "新 run" }] },
        ],
      },
    });
    expect(ok.statusCode).toBe(200);
    const replay = (await app.inject({ method: "GET", url: "/v1/journal/conv-rw/replay", headers: auth(s) })).json() as any;
    expect(replay.events).toHaveLength(2);
    expect(replay.events.every((e: any) => e.kind === "snapshot")).toBe(true);
    expect(JSON.parse(replay.events[0].payload)[0].content).toBe("压缩摘要");
    expect(replay.events[1].run_seq).toBe(2);
    expect(replay.events.some((e: any) => JSON.stringify(e.payload).includes("旧内容"))).toBe(false);

    // 无租约 rewrite 被拒
    const noLease = await app.inject({
      method: "PUT", url: "/v1/journal/conv-rw/rewrite", headers: auth(s),
      payload: { expectedLastSeq: 999, runs: [] },
    });
    expect([400, 423, 410]).toContain(noLease.statusCode);
  });

  it("replay ?since= 增量与 lastSeq（纯云端化 FR1）", async () => {
    const { app } = await makeApp();
    const s = await registerUser(app, "ledger-since");
    const lease = await acquireLease(app, s, "conv-since");
    const push = (messages: unknown[]) =>
      app.inject({
        method: "POST", url: "/v1/runs/conv-since/events", headers: auth(s),
        payload: { runSeq: 1, kind: "append", messages, leaseToken: lease },
      });
    const r1 = await (await push([{ type: "user", content: "一" }])).json();
    const r2 = await (await push([{ type: "user", content: "二" }])).json();
    const r3 = await (await push([{ type: "user", content: "三" }])).json();

    // since 只回 seq > since 的行；lastSeq 恒为该会话当前最大 seq
    const delta = (await app.inject({
      method: "GET", url: `/v1/journal/conv-since/replay?since=${r1.seq}`, headers: auth(s),
    })).json() as any;
    expect(delta.events.map((e: any) => e.seq)).toEqual([r2.seq, r3.seq]);
    expect(delta.lastSeq).toBe(r3.seq);

    // 缺省 since = 全量（向后兼容），lastSeq 一致
    const full = (await app.inject({
      method: "GET", url: "/v1/journal/conv-since/replay", headers: auth(s),
    })).json() as any;
    expect(full.events).toHaveLength(3);
    expect(full.lastSeq).toBe(r3.seq);

    // since 超前 → 空集但 lastSeq 仍回真值（客户端收缩判定依据）
    const ahead = (await app.inject({
      method: "GET", url: `/v1/journal/conv-since/replay?since=${r3.seq + 100}`, headers: auth(s),
    })).json() as any;
    expect(ahead.events).toHaveLength(0);
    expect(ahead.lastSeq).toBe(r3.seq);

    // 跨用户 owner 判定不因 since 滤空而放行（账本仍有行时，非 owner 用高 since 探测须 403）
    const stranger = await registerUser(app, "ledger-since-stranger", "S");
    const probe = await app.inject({
      method: "GET", url: `/v1/journal/conv-since/replay?since=${r3.seq + 100}`, headers: auth(stranger),
    });
    expect(probe.statusCode).toBe(403);

    // rewrite 清空（runs=[]）→ lastSeq 归 0（客户端「lastSeq < 本地尾序」触发镜像全量重建）
    await app.inject({
      method: "PUT", url: "/v1/journal/conv-since/rewrite", headers: auth(s),
      payload: { expectedLastSeq: r3.seq, leaseToken: lease, runs: [] },
    });
    const emptied = (await app.inject({
      method: "GET", url: "/v1/journal/conv-since/replay", headers: auth(s),
    })).json() as any;
    expect(emptied.events).toHaveLength(0);
    expect(emptied.lastSeq).toBe(0);
  });
});
