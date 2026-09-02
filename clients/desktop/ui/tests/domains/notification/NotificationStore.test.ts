/**
 * NotificationStore 单元测试：upsert 去重与未读保留、markRead/markAllRead、
 * remove/clear、50 条上限。
 */
import { describe, expect, it } from "vitest";
import { NotificationStore, type NotificationItem } from "../../../src/domains/notification/store/NotificationStore.js";

function item(id: string, overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id,
    type: "system",
    title: `标题 ${id}`,
    desc: "描述",
    createdAt: 1_000,
    read: false,
    ...overrides,
  };
}

describe("NotificationStore", () => {
  it("upsert 去重：同 id 更新内容且未读计数正确", () => {
    const store = new NotificationStore();
    store.upsert(item("a"));
    store.upsert(item("b"));
    expect(store.getSnapshot().items.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(store.getSnapshot().unreadCount).toBe(2);

    store.upsert(item("a", { title: "更新标题", read: true }));
    const updated = store.getSnapshot();
    expect(updated.items.find((entry) => entry.id === "a")!.title).toBe("更新标题");
    // read=true 不吞未读态（见下一用例），未读数仍为 2
    expect(updated.unreadCount).toBe(2);
  });

  it("同 id 已未读时，入参 read=true 不吞掉未读态（调用方控制何时置已读）", () => {
    const store = new NotificationStore();
    store.upsert(item("a"));
    store.upsert(item("a", { title: "t2", read: true }));
    expect(store.getSnapshot().items[0]!.read).toBe(false);
    expect(store.getSnapshot().unreadCount).toBe(1);
  });

  it("内容未变化的 upsert 不重发快照（引用相等）", () => {
    const store = new NotificationStore();
    store.upsert(item("a"));
    const snapshot = store.getSnapshot();
    store.upsert(item("a"));
    expect(store.getSnapshot()).toBe(snapshot);
  });

  it("markRead / markAllRead 清未读", () => {
    const store = new NotificationStore();
    store.upsert(item("a"));
    store.upsert(item("b"));

    store.markRead("a");
    expect(store.getSnapshot().unreadCount).toBe(1);
    store.markRead("a"); // 幂等
    expect(store.getSnapshot().unreadCount).toBe(1);

    store.markAllRead();
    expect(store.getSnapshot().unreadCount).toBe(0);
    const after = store.getSnapshot();
    store.markAllRead(); // 全已读时 no-op（快照引用不变）
    expect(store.getSnapshot()).toBe(after);
  });

  it("remove / clear", () => {
    const store = new NotificationStore();
    store.upsert(item("a"));
    store.upsert(item("b"));
    store.remove("a");
    expect(store.getSnapshot().items.map((entry) => entry.id)).toEqual(["b"]);
    store.remove("a"); // 不存在时 no-op

    store.clear();
    expect(store.getSnapshot().items).toHaveLength(0);
    expect(store.getSnapshot().unreadCount).toBe(0);
    const after = store.getSnapshot();
    store.clear(); // 空态 no-op
    expect(store.getSnapshot()).toBe(after);
  });

  it("超过 50 条丢最旧", () => {
    const store = new NotificationStore();
    for (let i = 0; i < 55; i += 1) store.upsert(item(`n${i}`));
    const ids = store.getSnapshot().items.map((entry) => entry.id);
    expect(ids).toHaveLength(50);
    expect(ids[0]).toBe("n5");
    expect(ids[49]).toBe("n54");
  });
});
