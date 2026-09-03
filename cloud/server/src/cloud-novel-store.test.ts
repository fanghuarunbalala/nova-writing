/**
 * RemoteNovelStore 真 server 集成（项目域上云 PRD FR6/FR8）：
 * 建/开两个 store 实例（两会话）→ A 写（角色/大纲/段落）→ B query 可见 →
 * B 写 → A 可见 → 乐观锁语义保留（stale baseRevision 拒）→ 重开新实例全量恢复。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { RemoteNovelStore } from "@novel/core";
import { acquireLease, auth, createProject, makeApp, registerUser } from "./test-util.js";

describe("RemoteNovelStore 集成（真 server）", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let token: string;
  let projectId: string;

  beforeAll(async () => {
    const built = await makeApp();
    app = built.app;
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.addresses()[0]!;
    baseUrl = `http://${address.address}:${address.port}`;
    const s = await registerUser(app, "rns-user");
    token = s.accessToken;
    projectId = await createProject(app, s, "云小说");
    await acquireLease(app, s, "conv-rns-a");
    await acquireLease(app, s, "conv-rns-b");
  });
  afterAll(async () => {
    await app.close();
  });

  function makeStore(sessionTag: string, conversationId: string, lease: string): RemoteNovelStore {
    return new RemoteNovelStore({
      url: baseUrl,
      projectId,
      sessionTag,
      getAccessToken: async () => token,
      getLeaseToken: () => lease,
      getConversationId: () => conversationId,
    });
  }

  it("A 写 → B 可见；B 写 → A 可见；乐观锁保留；重开恢复", async () => {
    const leaseA = await acquireLease(app, { accessToken: token } as never, "conv-rns-a");
    const leaseB = await acquireLease(app, { accessToken: token } as never, "conv-rns-b");
    const a = makeStore("session-a", "conv-rns-a", leaseA);
    const b = makeStore("session-b", "conv-rns-b", leaseB);

    // A 建：大纲单元 + 角色 + 段落
    await a.mutate({ op: "outline.storyUnit.create", id: "unit-1", title: "第一幕" });
    await a.mutate({ op: "character.create", id: "char-1", input: { name: "沈砚" } });
    const paraResult = await a.mutate({
      op: "paragraph.insert", id: "para-1", storyUnitId: "unit-1", text: "雨落长街", rhythm: "beat", intensity: 3,
    });
    expect(paraResult.entity).toBe("paragraph");

    // B 全量可见（snapshot 重放）
    const bChars = (await b.query({ op: "characters.list" })) as Array<{ name: string }>;
    expect(bChars.map((c) => c.name)).toEqual(["沈砚"]);
    const bParas = (await b.query({ op: "paragraphs.list", storyUnitId: "unit-1" })) as Array<{ text: string }>;
    expect(bParas[0]!.text).toBe("雨落长街");

    // B 写 → A 可见（delta）
    await b.mutate({ op: "character.create", id: "char-2", input: { name: "旧识" } });
    const aChars = (await a.query({ op: "characters.list" })) as Array<{ name: string }>;
    expect(aChars.map((c) => c.name).sort()).toEqual(["旧识", "沈砚"]);

    // 乐观锁语义保留（投影引擎）：stale baseRevision 拒
    await expect(
      a.mutate({ op: "character.update", characterId: "char-1", baseRevision: 99, patch: { name: "x" } }),
    ).rejects.toThrow();

    // 重开（第三会话）：全量重放恢复同一状态
    await acquireLease(app, { accessToken: token } as never, "conv-rns-c");
    const leaseC = await acquireLease(app, { accessToken: token } as never, "conv-rns-c");
    const c = makeStore("session-c", "conv-rns-c", leaseC);
    const cChars = (await c.query({ op: "characters.list" })) as Array<{ name: string }>;
    expect(cChars.map((x) => x.name).sort()).toEqual(["旧识", "沈砚"]);
    const outline = (await c.query({ op: "outline.get" })) as { units: Array<{ id: string; title: string }> };
    expect(outline.units[0]!.title).toBe("第一幕");
  });
});
