/**
 * 沙箱对拍（项目域上云 PRD FR8）：桌面 files.ts 沙盒与 server 沙箱同一输入同判定。
 * 桌面侧 resolveInWorkspace 的「拒绝集合」样本在此逐一经 server 文件 API 复核——
 * 双端语义漂移（如 server 放行了桌面拒绝的形态）会让本测试变红。
 */
import { describe, expect, it } from "vitest";
import { resolveInWorkspace } from "@novel/core";
import { auth, createProject, makeApp, registerUser } from "./test-util.js";

/** 逃逸类：双端都必须拒绝（安全下界一致） */
const ESCAPE_SAMPLES = [
  "../escape.md",
  "chapters/../../escape.md",
  "/etc/passwd",
  "C:/windows/win.ini",
  "\\\\server\\share\\x",
  "a/\0b",
];
/** 收紧档：server 比桌面更严（网络面黑名单/顶层 allowlist——PRD §1 层 1 设计内不对称）；
 *  桌面可接受，但 server 必须拒绝 */
const SERVER_STRICTER_SAMPLES = [".git/config", "notes/.env.local", "random/outside.md"];

describe("沙箱对拍：桌面 resolveInWorkspace vs server 文件 API", () => {
  it("逃逸类同判：桌面拒绝 ⟺ server 拒绝", async () => {
    // 桌面侧判定（真实临时 workspace）
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const ws = await mkdtemp(join(tmpdir(), "parity-ws-"));

    // server 侧判定（真 API）
    const { app } = await makeApp();
    const s = await registerUser(app, "parity-user");
    const projectId = await createProject(app, s, "对拍项目");
    for (const sample of [...ESCAPE_SAMPLES, ...SERVER_STRICTER_SAMPLES]) {
      const desktopRejected = await resolveInWorkspace(ws, sample).then(
        () => false,
        () => true,
      );
      const res = await app.inject({
        method: "PUT", url: `/v1/projects/${projectId}/files/${encodeURIComponent(sample).replace(/%2F/gi, "/")}`,
        headers: auth(s), payload: { content: "x" },
      });
      const serverAccepted = res.statusCode === 200;
      if (ESCAPE_SAMPLES.includes(sample)) {
        expect(desktopRejected, `sample=${sample}：桌面未拒绝（沙盒缺口）`).toBe(true);
        expect(serverAccepted, `sample=${sample}：server 放行了桌面同判的逃逸形态（漂移！）`).toBe(false);
      } else {
        expect(serverAccepted, `sample=${sample}：收紧档路径 server 必须拒绝`).toBe(false);
      }
    }
  });

  it("正常写读回环：桌面语义路径（chapters/notes/design/.novel/cases）在 server 全通", async () => {
    const { app } = await makeApp();
    const s = await registerUser(app, "parity-ok-user");
    const projectId = await createProject(app, s, "回环项目");
    for (const path of ["chapters/12.md", "notes/idea.md", "design/sub/outline.json", ".novel/cases/f.md"]) {
      const put = await app.inject({
        method: "PUT", url: `/v1/projects/${projectId}/files/${path}`, headers: auth(s), payload: { content: `内容@${path}` },
      });
      expect(put.statusCode, `path=${path}`).toBe(200);
      const read = (await app.inject({ method: "GET", url: `/v1/projects/${projectId}/files/${path}`, headers: auth(s) })).json() as any;
      expect(read.content).toBe(`内容@${path}`);
    }
  });
});
