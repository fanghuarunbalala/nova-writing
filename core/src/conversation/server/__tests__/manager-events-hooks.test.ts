/**
 * ConversationManagerServer 事件接线钩子测试（gui-performance-2 功能点八）：
 * register 报到 / 进程退出 → main 侧 SUB 接入与拆除的通知时序。
 */
import { describe, it, expect } from "vitest";
import { ConversationManagerServer } from "../ConversationManagerServer.js";
import type { ConversationFactory } from "../ConversationManagerServer.js";

const factory = {} as ConversationFactory;

describe("ConversationManagerServer 事件接线钩子", () => {
  it("register → onRegistered 监听器收到会话 id；退订后不再通知", async () => {
    const manager = new ConversationManagerServer(factory);
    const received: string[] = [];
    const unsubscribe = manager.onRegistered((id) => {
      received.push(id);
    });
    await manager.register({ conversationId: "conv_1", name: "conv_1", storeDir: "/s" });
    expect(received).toEqual(["conv_1"]);
    unsubscribe();
    await manager.register({ conversationId: "conv_2", name: "conv_2", storeDir: "/s" });
    expect(received).toEqual(["conv_1"]);
  });

  it("terminate → onConversationExited 通知（内存模式无 attachExit，终止即拆除）", async () => {
    const manager = new ConversationManagerServer(factory);
    const received: string[] = [];
    manager.onConversationExited((id) => {
      received.push(id);
    });
    await manager.register({ conversationId: "conv_1", name: "conv_1", storeDir: "/s" });
    await manager.terminate("conv_1");
    expect(received).toEqual(["conv_1"]);
  });
});
