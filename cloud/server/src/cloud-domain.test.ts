import { describe, expect, it } from "vitest";
import { acquireLease, auth, createProject, makeApp, registerUser } from "./test-util.js";

/** 云项目域 API（domain_entities 通用实体存储，项目域上云 PRD FR3）。 */
describe("云项目域 API（snapshot/delta/mutate）", () => {
  async function setup(user = "cd-user") {
    const { app, hub } = await makeApp();
    const s = await registerUser(app, user);
    const projectId = await createProject(app, s, "域项目");
    const lease = await acquireLease(app, s, "conv-cd");
    return { app, hub, s, projectId, lease };
  }

  const mutate = (app: any, s: any, projectId: string, lease: string, mutations: unknown[]) =>
    app.inject({
      method: "POST", url: `/v1/projects/${projectId}/domain/mutate`, headers: auth(s),
      payload: { conversationId: "conv-cd", leaseToken: lease, mutations },
    });

  it("首拉 snapshot 空 → put 建 → delta 增量 → 乐观锁 409 自纠 → delete 软删", async () => {
    const { app, s, projectId, lease } = await setup();

    const empty = (await app.inject({ method: "GET", url: `/v1/projects/${projectId}/domain/snapshot`, headers: auth(s) })).json() as any;
    expect(empty).toMatchObject({ cursor: 0, entities: [] });

    // put 新建（v1）
    const m1 = await mutate(app, s, projectId, lease, [
      { kind: "chapter", id: "ch-1", op: "put", data: { title: "第一章", text: "雨夜" } },
      { kind: "character", id: "char-1", op: "put", data: { name: "沈砚" } },
    ]);
    expect(m1.statusCode).toBe(200);
    expect((m1.json() as any).results).toEqual([
      { id: "ch-1", kind: "chapter", entityVersion: 1 },
      { id: "char-1", kind: "character", entityVersion: 1 },
    ]);

    // snapshot 全量 + cursor
    const snap = (await app.inject({ method: "GET", url: `/v1/projects/${projectId}/domain/snapshot`, headers: auth(s) })).json() as any;
    expect(snap.entities).toHaveLength(2);
    expect(snap.entities[0].data.title).toBe("第一章");
    const cursor1 = snap.cursor;

    // delta：无新变更 → 空 + cursor 保持
    const delta0 = (await app.inject({ method: "GET", url: `/v1/projects/${projectId}/domain/delta?since=${cursor1}`, headers: auth(s) })).json() as any;
    expect(delta0.entities).toHaveLength(0);
    expect(delta0.cursor).toBe(cursor1);

    // 乐观锁：不带 baseVersion 更新已存在 → 409 附 currentVersion
    const stale = await mutate(app, s, projectId, lease, [
      { kind: "chapter", id: "ch-1", op: "put", data: { title: "第一章·改" } },
    ]);
    expect(stale.statusCode).toBe(409);
    expect((stale.json() as any).currentVersion).toBe(1);
    // 自纠：带 baseVersion=1 → v2
    const ok = await mutate(app, s, projectId, lease, [
      { kind: "chapter", id: "ch-1", op: "put", data: { title: "第一章·改" }, baseVersion: 1 },
    ]);
    expect((ok.json() as any).results[0].entityVersion).toBe(2);
    // delta 捕获 v2 变更
    const delta1 = (await app.inject({ method: "GET", url: `/v1/projects/${projectId}/domain/delta?since=${cursor1}`, headers: auth(s) })).json() as any;
    expect(delta1.entities).toHaveLength(1);
    expect(delta1.entities[0].data.title).toBe("第一章·改");

    // delete：baseVersion 必填 → 软删（entity 保留 deletedAt）
    const noBase = await mutate(app, s, projectId, lease, [{ kind: "chapter", id: "ch-1", op: "delete" }]);
    expect(noBase.statusCode).toBe(409);
    const del = await mutate(app, s, projectId, lease, [{ kind: "chapter", id: "ch-1", op: "delete", baseVersion: 2 }]);
    expect(del.statusCode).toBe(200);
    const snap2 = (await app.inject({ method: "GET", url: `/v1/projects/${projectId}/domain/snapshot`, headers: auth(s) })).json() as any;
    const deleted = snap2.entities.find((e: any) => e.id === "ch-1");
    expect(deleted.deletedAt).not.toBeUndefined();
    // 软删后同 id 再 put → 新生（v1，不带 baseVersion）
    const revive = await mutate(app, s, projectId, lease, [{ kind: "chapter", id: "ch-1", op: "put", data: { title: "重开" } }]);
    expect((revive.json() as any).results[0].entityVersion).toBe(1);
  });

  it("租约缺失/过期 → 400/410；kind 非法 → 400；跨用户 403", async () => {
    const { app, s, projectId } = await setup("cd-auth-user");
    const noLease = await app.inject({
      method: "POST", url: `/v1/projects/${projectId}/domain/mutate`, headers: auth(s),
      payload: { conversationId: "conv-cd", mutations: [{ kind: "note", id: "n1", op: "put", data: {} }] },
    });
    expect(noLease.statusCode).toBe(400);
    const badKind = await app.inject({
      method: "POST", url: `/v1/projects/${projectId}/domain/mutate`, headers: auth(s),
      payload: { conversationId: "conv-cd", leaseToken: "x", mutations: [{ kind: "Evil!", id: "n1", op: "put", data: {} }] },
    });
    expect(badKind.statusCode).toBe(400);
    await registerUser(app, "cd-mallory", "M");
    const mallory = (await app.inject({
      method: "POST", url: "/v1/auth/login",
      payload: { username: "cd-mallory", password: "password123", deviceName: "M" },
    })).json() as any;
    const forbidden = await app.inject({
      method: "GET", url: `/v1/projects/${projectId}/domain/snapshot`,
      headers: { authorization: `Bearer ${mallory.accessToken}` },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it("SSE domain_changed 广播 + 记账行（journal 重放可见）", async () => {
    const { app, hub, s, projectId, lease } = await setup("cd-sse-user");
    const events: any[] = [];
    const off = hub.subscribe((e) => events.push(e));
    await mutate(app, s, projectId, lease, [{ kind: "location", id: "loc-1", op: "put", data: { name: "长街" } }]);
    off();
    const domainEvents = events.filter((e) => e.type === "domain_changed");
    expect(domainEvents).toHaveLength(1);
    expect(domainEvents[0]).toMatchObject({ projectId, count: 1 });
    // 同事务记账：journal 事件带 mutations
    const journalEvents = events.filter((e) => e.type === "journal" && e.kind === "domain-mutation");
    expect(journalEvents).toHaveLength(1);
    // 重放恢复（第二端视角）
    const replay = (await app.inject({ method: "GET", url: "/v1/journal/conv-cd/replay", headers: auth(s) })).json() as any;
    expect(replay.events.some((e: any) => e.kind === "domain-mutation")).toBe(true);
  });
});
