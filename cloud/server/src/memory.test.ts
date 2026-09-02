import { describe, expect, it } from "vitest";
import { acquireLease, auth, createProject, makeApp, registerUser } from "./test-util.js";

describe("memory / NOVEL.md", () => {
  async function setup() {
    const { app } = await makeApp();
    const s = await registerUser(app, "mem-user");
    const projectId = await createProject(app, s, "记忆项目");
    const lease = await acquireLease(app, s, "conv-m");
    // 造一行真实账本（memory source 的追溯目标）
    const ev = (
      await app.inject({
        method: "POST", url: "/v1/runs/conv-m/events", headers: auth(s),
        payload: { runSeq: 1, kind: "snapshot", messages: [{ type: "user", content: "写一段" }], leaseToken: lease },
      })
    ).json() as any;
    return { app, s, projectId, lease, seq: ev.seq as number };
  }

  it("无 source / 伪造 source 拒绝；合法写入 → 文件 + 索引 + 记账", async () => {
    const { app, s, projectId, seq } = await setup();
    const put = (payload: Record<string, unknown>) =>
      app.inject({
        method: "PUT", url: `/v1/projects/${projectId}/files/memory/pacing.md`,
        headers: auth(s), payload,
      });

    const noSource = await put({ content: "节奏要快" });
    expect(noSource.statusCode).toBe(400);
    expect((noSource.json() as any).code).toBe("invalid_source");

    const fakeSource = await put({ content: "节奏要快", source: 999999 });
    expect(fakeSource.statusCode).toBe(400);

    const ok = await put({ content: "规则：三章一个小高潮\nWhy：读者留存\nHow：卡文时先检查", source: seq, conversationId: "conv-m" });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as any).seq).toBeGreaterThan(0);

    // 索引由 server 维护
    const index = (
      await app.inject({ method: "GET", url: `/v1/projects/${projectId}/files/memory/MEMORY.md`, headers: auth(s) })
    ).json() as any;
    expect(index.content).toContain("- pacing.md（source=seq:");
    // 索引文件本身不可直接写
    const writeIndex = await app.inject({
      method: "PUT", url: `/v1/projects/${projectId}/files/memory/MEMORY.md`, headers: auth(s),
      payload: { content: "篡改索引", source: seq },
    });
    expect(writeIndex.statusCode).toBe(400);
  });

  it("NOVEL.md 直接写被拒；经审批提案 approve 后落盘", async () => {
    const { app, s, projectId, lease, seq } = await setup();
    const direct = await app.inject({
      method: "PUT", url: `/v1/projects/${projectId}/files/NOVEL.md`, headers: auth(s),
      payload: { content: "静默改写", source: seq },
    });
    expect(direct.statusCode).toBe(403);
    expect((direct.json() as any).code).toBe("novel_md_requires_approval");

    // 提案路径：征询带 proposal → approve → server 落盘
    await app.inject({
      method: "POST", url: "/v1/approvals", headers: auth(s),
      payload: {
        conversationId: "conv-m", runSeq: 1, requestId: "approval:conv-m:1:b0",
        calls: [{ id: "c1", name: "novel_propose_constraints", arguments: "{}" }],
        proposal: { projectId, path: "NOVEL.md", content: "# 世界观铁律\n1. 修士不得越阶斩杀" },
        leaseToken: lease,
      },
    });
    await app.inject({
      method: "POST", url: "/v1/approvals/approval:conv-m:1:b0/resolve", headers: auth(s),
      payload: { decision: "approve" },
    });
    const file = (
      await app.inject({ method: "GET", url: `/v1/projects/${projectId}/files/NOVEL.md`, headers: auth(s) })
    ).json() as any;
    expect(file.content).toContain("世界观铁律");
  });
});
