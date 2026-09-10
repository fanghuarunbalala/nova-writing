import { describe, expect, it } from "vitest";
import { acquireLease, auth, createProject, makeApp, registerUser, type TestApp } from "./test-util.js";
import { validateProjectPath } from "./sandbox.js";

/** 云项目文件 API + 路径沙箱（项目域上云 PRD FR2）。 */
describe("沙箱纯函数 validateProjectPath（路由层 .. 归一之外的权威判定）", () => {
  const bad: Array<[string, string]> = [
    ["", "empty_path"],
    ["../escape.md", "escape"],
    ["chapters/../../escape.md", "escape"],
    // 连续分隔符被归一折叠 → 落到 allowlist 外拒绝（同样不可写）
    ["a//b.md", "outside_allowlist"],
    ["/etc/passwd", "absolute"],
    ["C:/win.ini", "absolute"],
    ["\\\\srv\\share\\x", "absolute"],
    ["a/\0b", "null_byte"],
    [".git/config", "blocked_segment"],
    ["notes/.env", "blocked_segment"],
    ["random/x.md", "outside_allowlist"],
    ["x".repeat(241) + ".md", "too_long"],
  ];
  for (const [path, code] of bad) {
    it(`拒绝 ${JSON.stringify(path.slice(0, 30))} → ${code}`, () => {
      expect(validateProjectPath(path)).toMatchObject({ ok: false, code });
    });
  }
  it("归一与 allowlist：反斜杠→posix、./ 剥离、NOVEL.md 放行", () => {
    expect(validateProjectPath("chapters\\12.md")).toEqual({ ok: true, path: "chapters/12.md" });
    expect(validateProjectPath("./notes/a.md")).toEqual({ ok: true, path: "notes/a.md" });
    expect(validateProjectPath("NOVEL.md")).toEqual({ ok: true, path: "NOVEL.md" });
    expect(validateProjectPath("design/sub/x.json")).toEqual({ ok: true, path: "design/sub/x.json" });
  });
});

describe("文件 API + 路径沙箱", () => {
  async function setup(user = "files-user"): Promise<TestApp & { s: Awaited<ReturnType<typeof registerUser>>; projectId: string }> {
    const made = await makeApp();
    const s = await registerUser(made.app, user);
    const projectId = await createProject(made.app, s, "文件项目");
    return { ...made, s, projectId };
  }

  const put = (app: any, s: any, projectId: string, path: string, payload: Record<string, unknown>) =>
    app.inject({ method: "PUT", url: `/v1/projects/${projectId}/files/${path}`, headers: auth(s), payload });

  it("沙箱用例表：逃逸/绝对/盘符/反斜杠归一/黑名单/allowlist 外全部 400", async () => {
    const { app, s, projectId } = await setup("sb-user");
    const cases: Array<[string, string, number]> = [
      // 前导/深层 .. 形态（裸/编码）被路由层归一拦截 → 404（不达 handler，同样不可写）
      ["../escape.md", "", 404],
      ["%2e%2e/escape.md", "", 404],
      ["chapters/%2e%2e/%2e%2e/escape.md", "", 404],
      ["/etc/passwd", "absolute", 400],
      ["C:/windows/win.ini", "absolute", 400],
      ["\\\\server\\share\\x", "absolute", 400],
      [".git/config", "blocked_segment", 400],
      ["notes/.env.local", "blocked_segment", 400],
      ["random/file.md", "outside_allowlist", 400],
    ];
    for (const [path, code, status] of cases) {
      const res = await put(app, s, projectId, path, { content: "x" });
      expect(res.statusCode, `path=${path}`).toBe(status);
      if (code !== "") {
        expect((res.json() as any).code, `path=${path}`).toBe(code);
      }
    }
    // allowlist 边界内全部可写（反斜杠归一为 posix）
    for (const path of ["chapters/12.md", "notes/idea.md", "design/outline.json", ".novel/cases/foreshadow.md", "chapters\\13.md"]) {
      const res = await put(app, s, projectId, path, { content: "ok" });
      expect(res.statusCode, `path=${path}`).toBe(200);
    }
  });

  it("内容超限 413（512KiB）", async () => {
    const { app, s, projectId } = await setup("size-user");
    const res = await put(app, s, projectId, "notes/big.md", { content: "x".repeat(512 * 1024 + 1) });
    expect(res.statusCode).toBe(413);
    expect((res.json() as any).code).toBe("too_large");
  });

  it("读-写-读回 + 列表（prefix 过滤）+ 软删后列表/读不可见", async () => {
    const { app, s, projectId } = await setup("rw-user");
    await put(app, s, projectId, "chapters/1.md", { content: "第一章" });
    await put(app, s, projectId, "chapters/2.md", { content: "第二章" });
    await put(app, s, projectId, "notes/idea.md", { content: "灵感" });

    const read = (await app.inject({ method: "GET", url: `/v1/projects/${projectId}/files/chapters/1.md`, headers: auth(s) })).json() as any;
    expect(read.content).toBe("第一章");

    const listAll = (await app.inject({ method: "GET", url: `/v1/projects/${projectId}/files`, headers: auth(s) })).json() as any;
    expect(listAll.files.map((f: any) => f.path).sort()).toEqual(["chapters/1.md", "chapters/2.md", "notes/idea.md"]);
    const listChapters = (await app.inject({ method: "GET", url: `/v1/projects/${projectId}/files?prefix=chapters/`, headers: auth(s) })).json() as any;
    expect(listChapters.files).toHaveLength(2);
    // bare 顶层名等价
    const listBare = (await app.inject({ method: "GET", url: `/v1/projects/${projectId}/files?prefix=chapters`, headers: auth(s) })).json() as any;
    expect(listBare.files).toHaveLength(2);

    // 软删
    const del = await app.inject({ method: "DELETE", url: `/v1/projects/${projectId}/files/chapters/2.md`, headers: auth(s) });
    expect(del.statusCode).toBe(204);
    const after = (await app.inject({ method: "GET", url: `/v1/projects/${projectId}/files`, headers: auth(s) })).json() as any;
    expect(after.files.map((f: any) => f.path)).not.toContain("chapters/2.md");
    const reread = await app.inject({ method: "GET", url: `/v1/projects/${projectId}/files/chapters/2.md`, headers: auth(s) });
    expect(reread.statusCode).toBe(404);
    // 同路径再写 = 覆盖软删（复活）
    expect((await put(app, s, projectId, "chapters/2.md", { content: "重写" })).statusCode).toBe(200);
  });

  it("乐观校验：expectedUpdatedAt 不符 409 附当前值；不带则盲写（last-write-wins）", async () => {
    const { app, s, projectId } = await setup("occ-user");
    const first = (await put(app, s, projectId, "chapters/x.md", { content: "v1" })).json() as any;
    const stale = await put(app, s, projectId, "chapters/x.md", { content: "v2", expectedUpdatedAt: first.updatedAt - 1 });
    expect(stale.statusCode).toBe(409);
    expect((stale.json() as any).currentUpdatedAt).toBe(first.updatedAt);
    // 不存在的文件带 expected → 409 currentUpdatedAt=0
    const ghost = await put(app, s, projectId, "chapters/ghost.md", { content: "x", expectedUpdatedAt: 123 });
    expect(ghost.statusCode).toBe(409);
    expect((ghost.json() as any).currentUpdatedAt).toBe(0);
    // 匹配则成功
    const ok = await put(app, s, projectId, "chapters/x.md", { content: "v2", expectedUpdatedAt: first.updatedAt });
    expect(ok.statusCode).toBe(200);
  });

  it("SSE file_changed 广播（hub 订阅可见，不含内容）", async () => {
    const { app, s, projectId, hub } = await setup("sse-user");
    const events: any[] = [];
    const off = hub.subscribe((e) => events.push(e));
    await put(app, s, projectId, "notes/live.md", { content: "实时" });
    await app.inject({ method: "DELETE", url: `/v1/projects/${projectId}/files/notes/live.md`, headers: auth(s) });
    off();
    const fileEvents = events.filter((e) => e.type === "file_changed");
    expect(fileEvents).toHaveLength(2);
    expect(fileEvents[0]).toMatchObject({ projectId, path: "notes/live.md", op: "write" });
    expect(fileEvents[1]).toMatchObject({ projectId, path: "notes/live.md", op: "delete" });
    expect(JSON.stringify(fileEvents)).not.toContain("实时");
  });

  it("memory 特例回归：无 source 拒绝、索引维护、MEMORY.md 不可直写/不可删", async () => {
    const { app } = await makeApp();
    const s = await registerUser(app, "mem2-user");
    const projectId = await createProject(app, s, "记忆2");
    const lease = await acquireLease(app, s, "conv-fm");
    const ev = (
      await app.inject({
        method: "POST", url: "/v1/runs/conv-fm/events", headers: auth(s),
        payload: { runSeq: 1, kind: "snapshot", messages: [{ type: "user", content: "hi" }], leaseToken: lease },
      })
    ).json() as any;

    const noSource = await put(app, s, projectId, "memory/pacing.md", { content: "x" });
    expect((noSource.json() as any).code).toBe("invalid_source");
    const ok = await put(app, s, projectId, "memory/pacing.md", { content: "节奏", source: ev.seq, conversationId: "conv-fm" });
    expect(ok.statusCode).toBe(200);
    const index = (await app.inject({ method: "GET", url: `/v1/projects/${projectId}/files/memory/MEMORY.md`, headers: auth(s) })).json() as any;
    expect(index.content).toContain("pacing.md");
    const delIndex = await app.inject({ method: "DELETE", url: `/v1/projects/${projectId}/files/memory/MEMORY.md`, headers: auth(s) });
    expect(delIndex.statusCode).toBe(400);
    const delNovel = await app.inject({ method: "DELETE", url: `/v1/projects/${projectId}/files/NOVEL.md`, headers: auth(s) });
    expect(delNovel.statusCode).toBe(400);
  });
});
