import { describe, expect, it } from "vitest";
import { auth, createProject, makeApp, registerUser } from "./test-util.js";

/** 项目生命周期（项目域上云 PRD FR1）：列表/排序/改名/归档/软删/越权。 */
describe("项目生命周期", () => {
  it("建项目 → 列表（活跃度排序）→ 改名 → 归档 → 软删后不可见", async () => {
    const { app } = await makeApp();
    const s = await registerUser(app, "prj-owner");
    const a = await createProject(app, s, "雪落长街");
    const b = await createProject(app, s, "第二本");

    // 文件写 touch 活跃度 → b 后建但 a 后活跃 → a 排前
    await app.inject({
      method: "PUT", url: `/v1/projects/${a}/files/notes/idea.md`, headers: auth(s),
      payload: { content: "灵感" },
    });
    const list = (await app.inject({ method: "GET", url: "/v1/projects", headers: auth(s) })).json() as any;
    expect(list.projects.map((p: any) => p.id)).toEqual([a, b]);
    expect(list.projects[0].name).toBe("雪落长街");
    expect(list.projects[0].lastActivityAt).toBeGreaterThan(0);

    // 改名 + 归档
    const renamed = await app.inject({
      method: "PATCH", url: `/v1/projects/${b}`, headers: auth(s), payload: { name: "第二本·改", archived: true },
    });
    expect(renamed.statusCode).toBe(200);
    expect((renamed.json() as any).project.name).toBe("第二本·改");
    const list2 = (await app.inject({ method: "GET", url: "/v1/projects", headers: auth(s) })).json() as any;
    expect(list2.projects.find((p: any) => p.id === b).archivedAt).not.toBeNull();

    // 软删 → 列表不可见 + 项目路由 404
    const del = await app.inject({ method: "DELETE", url: `/v1/projects/${b}`, headers: auth(s) });
    expect(del.statusCode).toBe(204);
    const list3 = (await app.inject({ method: "GET", url: "/v1/projects", headers: auth(s) })).json() as any;
    expect(list3.projects.map((p: any) => p.id)).toEqual([a]);
    const filesOnDeleted = await app.inject({
      method: "GET", url: `/v1/projects/${b}/files?prefix=notes/`, headers: auth(s),
    });
    expect(filesOnDeleted.statusCode).toBe(404);
  });

  it("跨用户：列表互不可见、文件/域路由 403", async () => {
    const { app } = await makeApp();
    const alice = await registerUser(app, "prj-alice");
    await registerUser(app, "prj-mallory", "M");
    const projectId = await createProject(app, alice, "私密项目");
    const mallory = (
      await app.inject({
        method: "POST", url: "/v1/auth/login",
        payload: { username: "prj-mallory", password: "password123", deviceName: "M" },
      })
    ).json() as any;
    const list = (await app.inject({
      method: "GET", url: "/v1/projects",
      headers: { authorization: `Bearer ${mallory.accessToken}` },
    })).json() as any;
    expect(list.projects).toHaveLength(0);
    const forbidden = await app.inject({
      method: "PUT", url: `/v1/projects/${projectId}/files/notes/x.md`,
      headers: { authorization: `Bearer ${mallory.accessToken}` }, payload: { content: "入侵" },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it("项目名校验：空白名回落未命名、超长拒绝", async () => {
    const { app } = await makeApp();
    const s = await registerUser(app, "prj-namer");
    const blank = (await app.inject({
      method: "POST", url: "/v1/projects", headers: auth(s), payload: { name: "   " },
    })).json() as any;
    expect(blank.name).toBe("未命名项目");
    const tooLong = await app.inject({
      method: "POST", url: "/v1/projects", headers: auth(s), payload: { name: "x".repeat(65) },
    });
    expect(tooLong.statusCode).toBe(400);
  });
});
