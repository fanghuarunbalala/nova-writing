import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConversationManagerServer } from "../ConversationManagerServer.js";
import { Conversation } from "../Conversation.js";
import type { AgentLoop } from "../../../runtime/loop/AgentLoop.js";

function mockLoop(): AgentLoop {
  return {
    run: async () => ({ final: { role: "assistant", content: "ok" }, usage: undefined }),
    followup: () => {
      throw new Error("不应到达");
    },
    steer: () => {},
    stop: () => {},
    cancel: () => {},
    onOutputEvent: () => () => {},
  } as unknown as AgentLoop;
}

function makeServer(storedirRoot: string): ConversationManagerServer {
  return new ConversationManagerServer(
    { create: () => new Conversation({ conversationId: "x", loop: mockLoop(), sampling: { model: "m" } }) },
    undefined,
    { storedirRoot },
  );
}

describe("ConversationManagerServer conversationId 路径遍历防护", () => {
  it.each([
    "..",
    "../outside",
    "..\\..\\..\\danger",
    "a/b",
    "a\\b",
    "C:\\evil",
    "./x",
    ".hidden",
    "a*b",
    "a?b",
    "a|b",
  ])("非法 id %j：createOrResume 拒绝且不产生目录", async (evil) => {
    const root = mkdtempSync(join(tmpdir(), "novel-sec-"));
    const server = makeServer(root);
    await expect(server.createOrResume(evil as never)).rejects.toThrow();
    await expect(server.delete(evil as never)).resolves.toBeUndefined();
    await expect(server.rename(evil as never, "n")).resolves.toBe(false);
    // storedirRoot 下无新增目录（除既有外）
    expect(readdirSync(root)).toHaveLength(0);
  });

  it("delete 非法 id 不删除 storedirRoot 外的目录", async () => {
    const root = mkdtempSync(join(tmpdir(), "novel-sec-"));
    const outside = join(root, "..", "novel-sec-outside-target");
    mkdirSync(outside, { recursive: true });
    const sentinel = join(outside, "keep.txt");
    writeFileSync(sentinel, "keep");
    const server = makeServer(root);
    await expect(server.delete("..\\novel-sec-outside-target" as never)).resolves.toBeUndefined();
    await expect(server.delete("../novel-sec-outside-target" as never)).resolves.toBeUndefined();
    expect(existsSync(sentinel)).toBe(true);
  });

  it("合法自定义 id（c1）正常创建", async () => {
    const root = mkdtempSync(join(tmpdir(), "novel-sec-"));
    const server = makeServer(root);
    const ref = await server.createOrResume("c1");
    expect(ref.conversationId).toBe("c1");
  });
});
