import { describe, expect, it } from "vitest";
import { acquireLease, auth, createProject, makeApp, registerUser } from "./test-util.js";

describe("域库写：乐观锁 + 同事务记账", () => {
  it("新建 v1 → 条件更新 v2 → 过期 base 409 附当前版本", async () => {
    const { app } = await makeApp();
    const s = await registerUser(app, "domain-user");
    const projectId = await createProject(app, s, "雪中悍刀行");
    const lease = await acquireLease(app, s, "conv-d");
    const mutate = (mutation: Record<string, unknown>) =>
      app.inject({
        method: "POST", url: "/v1/paragraphs/mutate", headers: auth(s),
        payload: { projectId, conversationId: "conv-d", leaseToken: lease, mutation },
      });

    // 新建（不带 baseRevision）
    const created = await mutate({ op: "write", id: "p-1", storyUnitId: "su-1", orderKey: 1, text: "初稿" });
    expect(created.statusCode).toBe(200);
    const c1 = created.json() as any;
    expect(c1.entityVersion).toBe(1);
    expect(c1.seq).toBeGreaterThan(0); // 账本行同事务产生

    // 合法推进 v1 → v2
    const bump = await mutate({
      op: "write", id: "p-1", storyUnitId: "su-1", orderKey: 1, text: "二稿", baseRevision: 1,
    });
    expect(bump.statusCode).toBe(200);
    expect((bump.json() as any).entityVersion).toBe(2);

    // 基于过期版本 v1 再改（当前已是 v2）→ 409 + currentVersion
    const stale = await mutate({
      op: "write", id: "p-1", storyUnitId: "su-1", orderKey: 1, text: "过期稿", baseRevision: 1,
    });
    expect(stale.statusCode).toBe(409);
    expect((stale.json() as any).currentVersion).toBe(2);

    // 不带 base 改已有实体 → 409（强制携带乐观锁版本）
    const noBase = await mutate({ op: "write", id: "p-1", storyUnitId: "su-1", orderKey: 1, text: "无锁稿" });
    expect(noBase.statusCode).toBe(409);
  });

  it("读列表 + 条件删除；owner-only", async () => {
    const { app } = await makeApp();
    const s = await registerUser(app, "domain-owner");
    const other = await registerUser(app, "domain-other", "别人");
    const projectId = await createProject(app, s, "项目A");
    const lease = await acquireLease(app, s, "conv-d2");
    await app.inject({
      method: "POST", url: "/v1/paragraphs/mutate", headers: auth(s),
      payload: {
        projectId, conversationId: "conv-d2", leaseToken: lease,
        mutation: { op: "write", id: "p-9", storyUnitId: "su-9", orderKey: 1, text: "要删的段落" },
      },
    });

    const listed = (
      await app.inject({ method: "GET", url: `/v1/paragraphs?projectId=${projectId}`, headers: auth(s) })
    ).json() as any;
    expect(listed.paragraphs).toHaveLength(1);
    expect(listed.paragraphs[0].entity_version).toBe(1);

    // 他人访问项目 → 403
    const forbidden = await app.inject({
      method: "GET", url: `/v1/paragraphs?projectId=${projectId}`, headers: auth(other),
    });
    expect(forbidden.statusCode).toBe(403);

    // 版本匹配删除成功
    const del = await app.inject({
      method: "POST", url: "/v1/paragraphs/mutate", headers: auth(s),
      payload: {
        projectId, conversationId: "conv-d2", leaseToken: lease,
        mutation: { op: "delete", id: "p-9", baseRevision: 1 },
      },
    });
    expect(del.statusCode).toBe(200);

    // 再删 → 409（已不存在）
    const delAgain = await app.inject({
      method: "POST", url: "/v1/paragraphs/mutate", headers: auth(s),
      payload: {
        projectId, conversationId: "conv-d2", leaseToken: lease,
        mutation: { op: "delete", id: "p-9", baseRevision: 1 },
      },
    });
    expect(delAgain.statusCode).toBe(409);
  });
});
