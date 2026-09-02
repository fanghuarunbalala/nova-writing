import { describe, expect, it } from "vitest";
import { acquireLease, auth, loginUser, makeApp, registerUser } from "./test-util.js";

describe("审批队列（两段式持久化）", () => {
  it("征询需租约；另一台设备可 resolve；重复 resolve 409", async () => {
    const { app } = await makeApp();
    const phone = await registerUser(app, "appr-user", "手机");
    const pc = await loginUser(app, "appr-user", "电脑");
    const lease = await acquireLease(app, phone, "conv-a");

    const req = await app.inject({
      method: "POST", url: "/v1/approvals", headers: auth(phone),
      payload: {
        conversationId: "conv-a", runSeq: 1, requestId: "approval:conv-a:1:b0",
        calls: [{ id: "c1", name: "novel_write_paragraph", arguments: "{}" }],
        leaseToken: lease,
      },
    });
    expect(req.statusCode).toBe(201);

    // 手机能看到 pending；电脑（另一台设备）resolve approve
    const before = (
      await app.inject({ method: "GET", url: "/v1/approvals?conversationId=conv-a", headers: auth(pc) })
    ).json() as any;
    expect(before.approvals[0].status).toBe("pending");

    const resolve = await app.inject({
      method: "POST", url: "/v1/approvals/approval:conv-a:1:b0/resolve", headers: auth(pc),
      payload: { decision: "approve" },
    });
    expect(resolve.statusCode).toBe(200);

    const again = await app.inject({
      method: "POST", url: "/v1/approvals/approval:conv-a:1:b0/resolve", headers: auth(pc),
      payload: { decision: "reject" },
    });
    expect(again.statusCode).toBe(409);
  });

  it("120s 无决策惰性标 expired", async () => {
    const { app, db } = await makeApp();
    const s = await registerUser(app, "appr-timeout", "T");
    const lease = await acquireLease(app, s, "conv-t");
    await app.inject({
      method: "POST", url: "/v1/approvals", headers: auth(s),
      payload: { conversationId: "conv-t", runSeq: 1, requestId: "approval:conv-t:1:b0", calls: [], leaseToken: lease },
    });
    // 直接回拨 created_at 模拟超时
    db.prepare("UPDATE approvals SET created_at = created_at - 200000").run();

    const list = (
      await app.inject({ method: "GET", url: "/v1/approvals?conversationId=conv-t", headers: auth(s) })
    ).json() as any;
    expect(list.approvals[0].status).toBe("expired");

    // 过期后不可再 resolve
    const resolve = await app.inject({
      method: "POST", url: "/v1/approvals/approval:conv-t:1:b0/resolve", headers: auth(s),
      payload: { decision: "approve" },
    });
    expect(resolve.statusCode).toBe(409);
  });
});
