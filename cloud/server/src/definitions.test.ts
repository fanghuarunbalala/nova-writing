import { describe, expect, it } from "vitest";
import { auth, makeApp, registerUser } from "./test-util.js";

function bundle(version: string, opts: { extraRenderer?: string } = {}) {
  return {
    bundleSchemaVersion: 1,
    definitionVersion: version,
    agentType: "novel",
    label: "Novel Agent",
    prompt: {
      recipe: [
        { kind: "static", sectionId: "novel.identity", version: "1.0.0", content: "你是网文创作助手" },
        { kind: "dynamic", sectionId: "novel.story_appeal", version: "2.0.0", rendererId: "novel.story_appeal" },
        ...(opts.extraRenderer
          ? [{ kind: "dynamic", sectionId: "new.section", version: "1.0.0", rendererId: opts.extraRenderer }]
          : []),
      ],
    },
    tools: { groups: [{ groupId: "novel.entities", version: "1.0.0", label: "实体", tools: ["NovelRead"] }] },
    nudges: [{ nudgeId: "todo_idle", trigger: "persistent" }],
    compact: {
      chain: [{ policyId: "t1-skeletonize", params: { t1Ratio: 0.7 } }],
      fuse: { retryOnce: true },
    },
    delegation: { mode: "subagent", allowedAgentTypes: ["Explore"] },
    communication: { role: "standalone" },
    runtimePolicyId: "default",
  };
}

const FULL_CAPS = {
  capabilities: {
    renderers: ["novel.story_appeal"],
    policies: ["t1-skeletonize"],
    triggers: ["todo_idle"],
    toolGroups: ["novel.entities"],
  },
};

describe("定义包：存储/分发/能力协商", () => {
  it("上传不可变：同版本 409；拉取带 ETag/304", async () => {
    const { app } = await makeApp();
    const s = await registerUser(app, "def-user");

    const up = await app.inject({
      method: "POST", url: "/v1/definitions", headers: auth(s), payload: bundle("1.5.0"),
    });
    expect(up.statusCode).toBe(201);

    const dup = await app.inject({
      method: "POST", url: "/v1/definitions", headers: auth(s), payload: bundle("1.5.0"),
    });
    expect(dup.statusCode).toBe(409);

    const got = await app.inject({
      method: "GET", url: "/v1/definitions/1.5.0", headers: auth(s),
    });
    expect(got.statusCode).toBe(200);
    const etag = got.headers.etag as string;
    expect((got.json() as any).bundle.prompt.recipe).toHaveLength(2);
    expect((got.json() as any).requirements.renderers).toEqual(["novel.story_appeal"]);

    const notModified = await app.inject({
      method: "GET", url: "/v1/definitions/1.5.0", headers: { ...auth(s), "if-none-match": etag },
    });
    expect(notModified.statusCode).toBe(304);
  });

  it("resolve：能力全 → 最新版；能力缺 → 停在能跑的旧版；全缺 → 404", async () => {
    const { app } = await makeApp();
    const s = await registerUser(app, "def-resolve");
    for (const v of ["1.5.0", "1.6.0", "2.0.0"]) {
      const res = await app.inject({
        method: "POST", url: "/v1/definitions", headers: auth(s),
        // 2.0.0 用了新渲染器，1.6.0/1.5.0 没有
        payload: bundle(v, { extraRenderer: v === "2.0.0" ? "novel.future_section" : undefined }),
      });
      expect(res.statusCode).toBe(201);
    }

    // 能力全（含新渲染器）→ 最新 2.0.0
    const full = await app.inject({
      method: "POST", url: "/v1/definitions/resolve", headers: auth(s),
      payload: {
        ...FULL_CAPS,
        capabilities: { ...FULL_CAPS.capabilities, renderers: ["novel.story_appeal", "novel.future_section"] },
      },
    });
    expect(full.statusCode).toBe(200);
    expect((full.json() as any).bundle.definitionVersion).toBe("2.0.0");

    // 老 App（无新渲染器）→ 自动停在 1.6.0
    const oldApp = await app.inject({
      method: "POST", url: "/v1/definitions/resolve", headers: auth(s), payload: FULL_CAPS,
    });
    expect(oldApp.statusCode).toBe(200);
    expect((oldApp.json() as any).bundle.definitionVersion).toBe("1.6.0");

    // 什么都不支持 → 404 提示升级
    const none = await app.inject({
      method: "POST", url: "/v1/definitions/resolve", headers: auth(s),
      payload: { capabilities: {} },
    });
    expect(none.statusCode).toBe(404);
    expect((none.json() as any).code).toBe("no_compatible_definition");
  });

  it("未认证上传被拒；坏版本号被拒", async () => {
    const { app } = await makeApp();
    const s = await registerUser(app, "def-bad");
    const noAuth = await app.inject({ method: "POST", url: "/v1/definitions", payload: bundle("1.0.0") });
    expect(noAuth.statusCode).toBe(401);
    const badVersion = await app.inject({
      method: "POST", url: "/v1/definitions", headers: auth(s), payload: bundle("v1.0"),
    });
    expect(badVersion.statusCode).toBe(400);
  });
});
