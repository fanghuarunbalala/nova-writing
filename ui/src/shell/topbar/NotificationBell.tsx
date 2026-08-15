/**
 * NotificationBell
 *
 * 顶栏通知中心（对齐 demo .bellWrap/.notifMenu）：铃铛 IconButton + 未读红角标，
 * radix DropdownMenu 下拉面板——头行（通知 + 计数 chip + 全部已读 ghost）、
 * 五类色调条目（26px tone 图标 + 标题/描述 + 未读点，已读 60%）、
 * 分隔线 + 通知设置入口。条目激活 → markRead + onActivate（view 级跳转由 shell 接线）。
 */
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Bell,
  Check,
  FolderOpen,
  MapPin,
  Settings,
  ShieldCheck,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { useExternalStore } from "../../shared/state/useExternalStore.js";
import { Icon } from "../../shared/primitives/Icon.js";
import { IconButton } from "../../shared/primitives/IconButton.js";
import { Button } from "../../shared/primitives/Button.js";
import type {
  NotificationItem,
  NotificationStore,
  NotificationType,
} from "../../domains/notification/index.js";
import styles from "./NotificationBell.module.css";

/** 类型 → [图标, 色调]（demo NOTIF_META：approval/writing/profile/done/system） */
const TYPE_META: Readonly<
  Record<NotificationType, { readonly icon: LucideIcon; readonly tone: string | undefined }>
> = {
  approval: { icon: ShieldCheck, tone: styles.toneWarn },
  writing: { icon: TriangleAlert, tone: styles.toneDanger },
  profile: { icon: MapPin, tone: styles.toneInfo },
  done: { icon: Check, tone: styles.toneSuccess },
  system: { icon: FolderOpen, tone: styles.toneNeutral },
};

export interface NotificationBellProps {
  readonly store: NotificationStore;
  /** 条目激活（点击/回车）：markRead 后回调，shell 负责 view 级跳转 */
  readonly onActivate?: (item: NotificationItem) => void;
  /** 「通知设置…」入口（缺省不渲染底行） */
  readonly onOpenSettings?: () => void;
}

export function NotificationBell({ store, onActivate, onOpenSettings }: NotificationBellProps) {
  const snapshot = useExternalStore(store);
  const unread = snapshot.unreadCount;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <IconButton label="通知中心" className={styles.bellWrap}>
          <Icon icon={Bell} size="sm" />
          {unread > 0 ? <span className={styles.bellBadge}>{unread}</span> : null}
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={styles.menu} align="end" sideOffset={6}>
          <div className={styles.head}>
            <b>通知</b>
            <span className={[styles.cnt, unread === 0 ? styles.cntZero : ""].filter(Boolean).join(" ")}>
              {unread}
            </span>
            <span className={styles.spacer} />
            <Button variant="ghost" size="sm" onClick={() => store.markAllRead()}>
              全部已读
            </Button>
          </div>
          {snapshot.items.length === 0 ? (
            <div className={styles.empty}>暂无通知</div>
          ) : (
            snapshot.items.map((item) => {
              const meta = TYPE_META[item.type];
              return (
                <DropdownMenu.Item
                  asChild
                  key={item.id}
                  onSelect={() => {
                    store.markRead(item.id);
                    onActivate?.(item);
                  }}
                >
                  <button
                    type="button"
                    className={[styles.item, item.read ? styles.read : ""].filter(Boolean).join(" ")}
                    title={item.title}
                  >
                    <span className={[styles.iconBox, meta.tone].filter(Boolean).join(" ")}>
                      <Icon icon={meta.icon} size="sm" />
                    </span>
                    <span className={styles.texts}>
                      <b>{item.title}</b>
                      <small>{item.desc}</small>
                    </span>
                    {item.read ? null : <span className={styles.dot} />}
                  </button>
                </DropdownMenu.Item>
              );
            })
          )}
          {onOpenSettings !== undefined ? (
            <>
              <div className={styles.divider} />
              <DropdownMenu.Item asChild onSelect={onOpenSettings}>
                <button type="button" className={styles.footer}>
                  <Icon icon={Settings} size="sm" />
                  <span>通知设置…</span>
                </button>
              </DropdownMenu.Item>
            </>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
