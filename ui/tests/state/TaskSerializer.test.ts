/**
 * TaskSerializer 单元测试：串行执行、失败隔离、clear 重置。
 */
import { describe, expect, it } from "vitest";
import { TaskSerializer } from "../../src/shared/state/TaskSerializer.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("TaskSerializer", () => {
  it("runs tasks serially in submission order", async () => {
    const serializer = new TaskSerializer();
    const order: number[] = [];
    const first = serializer.run(async () => {
      order.push(1);
      await delay(10);
      order.push(2);
    });
    const second = serializer.run(async () => {
      order.push(3);
    });
    await Promise.all([first, second]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("isolates a failed task so later tasks still run", async () => {
    const serializer = new TaskSerializer();
    await expect(
      serializer.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(serializer.run(async () => 42)).resolves.toBe(42);
  });

  it("clear() resets the pending chain", async () => {
    const serializer = new TaskSerializer();
    const first = serializer.run(async () => {
      await delay(10);
      return "first";
    });
    serializer.clear();
    // 新任务不再等待 first（clear 后链已重置），但仍会先完成 first 的 Promise。
    const second = serializer.run(async () => "second");
    await expect(second).resolves.toBe("second");
    await expect(first).resolves.toBe("first");
  });
});
