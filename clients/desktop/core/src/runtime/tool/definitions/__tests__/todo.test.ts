import { describe, it, expect } from "vitest";
import { createTodoWriteTool } from "../todo.js";
import { InMemoryConversationTodoStore } from "../../../todo/InMemoryConversationTodoStore.js";
import type { ToolCall } from "../../../provider/types.js";

function call(args: Record<string, unknown>): ToolCall {
  return { id: "c1", name: "TodoWrite", args: JSON.stringify(args) };
}

describe("createTodoWriteTool", () => {
  it("写入 todo 列表并读回", async () => {
    const store = new InMemoryConversationTodoStore();
    const tool = createTodoWriteTool(store, "c1");
    await tool.handler.execute(
      call({ todos: [{ content: "完成第一章", status: "in_progress", activeForm: "正在完成第一章" }] }),
    );
    const snapshot = await store.read("c1");
    expect(snapshot?.todos).toHaveLength(1);
    expect(snapshot?.todos[0]).toMatchObject({ content: "完成第一章", status: "in_progress" });
    expect(snapshot?.revision).toBe(1);
  });

  it("整体替换：再次写入覆盖 + revision 递增", async () => {
    const store = new InMemoryConversationTodoStore();
    const tool = createTodoWriteTool(store, "c1");
    await tool.handler.execute(call({ todos: [{ content: "a", status: "pending", activeForm: "A" }] }));
    await tool.handler.execute(call({ todos: [{ content: "b", status: "completed", activeForm: "B" }] }));
    const snapshot = await store.read("c1");
    expect(snapshot?.todos).toHaveLength(1);
    expect(snapshot?.todos[0].content).toBe("b");
    expect(snapshot?.revision).toBe(2);
  });
});
