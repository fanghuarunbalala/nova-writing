import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import type { SseHub } from "./sse.js";
import { acquireLease, auth, createProject, loginUser, openSse, registerUser, type Session } from "./test-util.js";

/**
 * e2e 冒烟（PRD §6）：注册（手机）→ 电脑登录（同账号）→ 手机申请租约上推事件
 * → 电脑 SSE 实时收到 → 手机提交审批征询 → 电脑 resolve → 手机收到决议 SSE
 * → 域写乐观锁 → 断线重连（since 游标补拉）→ 重放恢复。
 */
describe("e2e 端到端", () => {
  let app: FastifyInstance;
  let db: Db;
  let hub: SseHub;
  let baseUrl: string;
  let phone: Session;
  let pc: Session;
  let projectId: string;
  let leaseToken: string;
  let firstSeq: number;

  beforeAll(async () => {
    const built = await (await import("./index.js")).buildServer({ secret: "e2e-secret" });
    app = built.app;
    db = built.db;
    hub = built.hub;
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.addresses()[0]!;
    baseUrl = `http://${address.address}:${address.port}`;
  });
  afterAll(async () => {
    await app.close();
  });

  it("手机注册并取得租约与项目", async () => {
    phone = await registerUser(app, "e2e-author", "手机");
    pc = await loginUser(app, "e2e-author", "电脑");
    projectId = await createProject(app, phone, "雪落长街");
    leaseToken = await acquireLease(app, phone, "conv-e2e");
  });

  it("电脑通过 SSE 实时看到手机上推的账本事件", async () => {
    const stream = openSse(baseUrl, "conversationId=conv-e2e&since=0", {
      authorization: `Bearer ${pc.accessToken}`,
    });
    await stream.ready; // 连接就绪后再上推，消除订阅竞态
    const push = (
      await app.inject({
        method: "POST", url: "/v1/runs/conv-e2e/events", headers: auth(phone),
        payload: {
          runSeq: 1, kind: "snapshot", definitionVersion: "1.5.0", leaseToken,
          messages: [{ type: "user", content: "续写第12章" }],
        },
      })
    ).json() as any;
    firstSeq = push.seq;
    await stream.waitFor((events) => events.some((e) => e.type === "journal" && e.seq === firstSeq));
    stream.close();
    expect(stream.events.some((e) => e.type === "ready")).toBe(true);
    expect(stream.events.some((e) => e.type === "journal" && e.payload?.[0]?.content === "续写第12章")).toBe(true);
  });

  it("手机提交审批征询 → 电脑 resolve → SSE 决议广播", async () => {
    const stream = openSse(baseUrl, "conversationId=conv-e2e&since=" + firstSeq, {
      authorization: `Bearer ${phone.accessToken}`,
    });
    await stream.ready;
    await app.inject({
      method: "POST", url: "/v1/approvals", headers: auth(phone),
      payload: {
        conversationId: "conv-e2e", runSeq: 1, requestId: "approval:conv-e2e:1:b0",
        calls: [{ id: "c1", name: "novel_write_paragraph", arguments: '{"id":"p-1"}' }],
        leaseToken,
      },
    });
    const resolve = await app.inject({
      method: "POST", url: "/v1/approvals/approval:conv-e2e:1:b0/resolve", headers: auth(pc),
      payload: { decision: "approve" },
    });
    expect(resolve.statusCode).toBe(200);
    await stream.waitFor((events) => events.some((e) => e.type === "approval_resolved"));
    stream.close();
    const requested = stream.events.find((e) => e.type === "approval_requested");
    expect(requested?.calls[0].name).toBe("novel_write_paragraph");
    const resolved = stream.events.find((e) => e.type === "approval_resolved");
    expect(resolved?.decision).toBe("approve");
    expect(resolved?.decidedBy).toBe(pc.deviceId);
  });

  it("审批后的域写：乐观锁全流程", async () => {
    const write = (
      await app.inject({
        method: "POST", url: "/v1/paragraphs/mutate", headers: auth(phone),
        payload: {
          projectId, conversationId: "conv-e2e", leaseToken,
          mutation: { op: "write", id: "p-1", storyUnitId: "su-12", orderKey: 1, text: "雪落了满街。" },
        },
      })
    ).json() as any;
    expect(write.entityVersion).toBe(1);

    // 合法推进 v1 → v2，然后基于 v1 的过期写入 → 409 附当前版本
    const bump = await app.inject({
      method: "POST", url: "/v1/paragraphs/mutate", headers: auth(phone),
      payload: {
        projectId, conversationId: "conv-e2e", leaseToken,
        mutation: { op: "write", id: "p-1", storyUnitId: "su-12", orderKey: 1, text: "修订稿。", baseRevision: 1 },
      },
    });
    expect(bump.statusCode).toBe(200);

    const stale = await app.inject({
      method: "POST", url: "/v1/paragraphs/mutate", headers: auth(phone),
      payload: {
        projectId, conversationId: "conv-e2e", leaseToken,
        mutation: { op: "write", id: "p-1", storyUnitId: "su-12", orderKey: 1, text: "过期稿", baseRevision: 1 },
      },
    });
    expect(stale.statusCode).toBe(409);
    expect((stale.json() as any).currentVersion).toBe(2);
  });

  it("断线重连：since 游标补拉 + 全量重放恢复", async () => {
    // 新设备（平板）登录，从 0 重放整个会话
    const tablet = await loginUser(app, "e2e-author", "平板");
    const replay = (
      await app.inject({ method: "GET", url: "/v1/journal/conv-e2e/replay", headers: auth(tablet) })
    ).json() as any;
    const kinds = replay.events.map((e: any) => e.kind);
    expect(kinds).toContain("snapshot");
    expect(kinds).toContain("domain-mutation"); // 域写也记了账

    // since 游标：只收到 firstSeq 之后的事件（幂等补拉）
    const stream = openSse(baseUrl, "conversationId=conv-e2e&since=" + firstSeq, {
      authorization: `Bearer ${tablet.accessToken}`,
    });
    await stream.ready;
    stream.close();
    const journalEvents = stream.events.filter((e) => e.type === "journal");
    expect(journalEvents.length).toBeGreaterThan(0);
    expect(journalEvents.every((e: any) => e.seq > firstSeq)).toBe(true);

    // 平板想抢租约 → 409（手机仍持有）
    const conflict = await app.inject({
      method: "POST", url: "/v1/leases", headers: auth(tablet), payload: { conversationId: "conv-e2e" },
    });
    expect(conflict.statusCode).toBe(409);
    expect((conflict.json() as any).holderDeviceId).toBe(phone.deviceId);
  });
});
