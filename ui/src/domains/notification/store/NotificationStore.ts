/**
 * NotificationStore
 *
 * 顶栏通知中心数据源（shell 级 ExternalStore）：进程内会话级聚合，
 * 不持久化（重启清空；切换工作区时由 shell 调 clear() 清空再记切换通知）。
 * 类型对齐 demo 五类：approval 审批 / writing 写作 / profile 档案 /
 * done 完成 / system 系统——后三类事件源暂缺，类型留扩展。
 */
import { ExternalStore } from "../../../shared/state/ExternalStore.js";
import type { MainViewState } from "../../../shared/routing/MainViewRouter.js";

/** 通知类型（demo NOTIF_META：approval/writing/profile/done/system + asking 提问） */
export type NotificationType = "approval" | "asking" | "writing" | "profile" | "done" | "system";

export interface NotificationItem {
  readonly id: string;
  readonly type: NotificationType;
  readonly title: string;
  readonly desc: string;
  readonly createdAt: number;
  readonly read: boolean;
  /** 激活跳转（仅 view 级；demo 的 unit/loc 级来源暂缺） */
  readonly goto?: { readonly view: MainViewState };
}

export interface NotificationSnapshot {
  readonly items: readonly NotificationItem[];
  readonly unreadCount: number;
}

/** 列表上限（超出丢最旧；demo max-height 64vh 滚动，无需更长） */
const MAX_ITEMS = 50;

const EMPTY: NotificationSnapshot = Object.freeze({ items: Object.freeze([]), unreadCount: 0 });

export class NotificationStore extends ExternalStore<NotificationSnapshot> {
  constructor() {
    super(EMPTY);
  }

  /**
   * 插入或更新（id 去重）：同 id 已存在且入参 read=true 时保留原未读态
   * 由调用方控制（如审批聚合仅在计数增长时置 unread）；新条目按入参。
   */
  upsert(item: NotificationItem): void {
    const existing = this.snapshot.items.find((entry) => entry.id === item.id);
    const next =
      existing !== undefined && item.read && !existing.read ? { ...item, read: false } : item;
    if (existing !== undefined && this.sameItem(existing, next)) return;
    const rest = this.snapshot.items.filter((entry) => entry.id !== item.id);
    this.publish([...rest, next]);
  }

  markRead(id: string): void {
    const target = this.snapshot.items.find((entry) => entry.id === id);
    if (target === undefined || target.read) return;
    this.publish(
      this.snapshot.items.map((entry) => (entry.id === id ? { ...entry, read: true } : entry)),
    );
  }

  markAllRead(): void {
    if (this.snapshot.unreadCount === 0) return;
    this.publish(this.snapshot.items.map((entry) => ({ ...entry, read: true })));
  }

  remove(id: string): void {
    if (!this.snapshot.items.some((entry) => entry.id === id)) return;
    this.publish(this.snapshot.items.filter((entry) => entry.id !== id));
  }

  /** 清空（切换工作区：跨项目不串通知） */
  clear(): void {
    if (this.snapshot.items.length === 0) return;
    this.setSnapshot(EMPTY);
  }

  /** 条目等价（同 id 下字段全等则不重发快照） */
  private sameItem(a: NotificationItem, b: NotificationItem): boolean {
    return (
      a.type === b.type &&
      a.title === b.title &&
      a.desc === b.desc &&
      a.read === b.read &&
      a.goto?.view === b.goto?.view
    );
  }

  /** 统一收口：截断上限 + 冻结 + 未读计数 */
  private publish(items: readonly NotificationItem[]): void {
    const trimmed = items.length > MAX_ITEMS ? items.slice(items.length - MAX_ITEMS) : items;
    this.setSnapshot(
      Object.freeze({
        items: Object.freeze(trimmed),
        unreadCount: trimmed.filter((item) => !item.read).length,
      }),
    );
  }
}
