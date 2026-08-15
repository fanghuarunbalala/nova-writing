/**
 * ConversationListSection
 *
 * 对话列表 section（对齐 demo）：搜索框（本地过滤）+ 时间分组
 * （置顶 / 今天 / 更早，按 lastActivityAt）+ 列表行。
 * 重命名/删除弹窗状态本地持有（G7：以自定义 Dialog 替代原生 prompt/confirm，
 * 后者在 Electron 渲染进程不可用或不一致）。
 */
import { useCallback, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { ConversationList } from "../../../domains/conversation/components/ConversationList.js";
import {
  ConversationDialogs,
  type RenameTarget,
} from "../../../domains/conversation/components/ConversationDialogs.js";
import type { ConversationCatalogStore } from "../../../domains/conversation/store/ConversationCatalogStore.js";
import type { ToastStore } from "../../../shared/state/ToastStore.js";
import { useExternalStore } from "../../../shared/state/useExternalStore.js";
import { Icon } from "../../../shared/primitives/Icon.js";
import styles from "./ConversationListSection.module.css";
import dirStyles from "./directory.module.css";

export interface ConversationListSectionProps {
  readonly store: ConversationCatalogStore;
  readonly toastStore: ToastStore;
  readonly onSelect: (id: string) => void;
}

interface ConversationGroup {
  readonly label: string;
  readonly items: readonly {
    readonly id: string;
    readonly title: string;
    readonly agentLabel: string;
    readonly lastActivityAt: number;
    readonly status?: "generating" | "failed" | "unavailable";
    readonly pinned?: boolean;
  }[];
}

/** 置顶 / 今天 / 更早 三组（组内保持 store 顺序） */
function groupConversations(
  conversations: readonly ConversationGroup["items"][number][],
): readonly ConversationGroup[] {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayMs = startOfToday.getTime();
  const pinned: ConversationGroup["items"][number][] = [];
  const today: ConversationGroup["items"][number][] = [];
  const earlier: ConversationGroup["items"][number][] = [];
  for (const item of conversations) {
    if (item.pinned === true) pinned.push(item);
    else if (item.lastActivityAt >= todayMs) today.push(item);
    else earlier.push(item);
  }
  return [
    { label: "置顶", items: pinned },
    { label: "今天", items: today },
    { label: "更早", items: earlier },
  ].filter((group) => group.items.length > 0);
}

export function ConversationListSection({
  store,
  toastStore,
  onSelect,
}: ConversationListSectionProps) {
  const snapshot = useExternalStore(store);
  const [query, setQuery] = useState("");
  const [renameTarget, setRenameTarget] = useState<RenameTarget | undefined>(undefined);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | undefined>(undefined);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // 本地搜索：按标题 / agentLabel 过滤（大小写不敏感）
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return snapshot.conversations;
    return snapshot.conversations.filter(
      (item) =>
        item.title.toLowerCase().includes(q) || item.agentLabel.toLowerCase().includes(q),
    );
  }, [snapshot.conversations, query]);
  const groups = useMemo(() => groupConversations(filtered), [filtered]);

  const closeDialogs = (): void => {
    setRenameTarget(undefined);
    setRenameValue("");
    setDeleteTarget(undefined);
  };

  // 稳定回调（列表行 memo 生效前提，gui-performance-2 功能点五）
  const handleRename = useCallback(
    (id: string) => {
      const current = store.getSnapshot().conversations.find((item) => item.id === id)?.title ?? "";
      setRenameValue(current);
      setRenameTarget({ id, title: current });
    },
    [store],
  );
  const handlePin = useCallback(
    (id: string, pinned: boolean) => {
      // pinConversation 为存根（core 契约延后）：显性提示，避免 unhandled rejection
      void store.pinConversation(id, pinned).catch(() => {
        toastStore.push({ kind: "warn", text: "置顶暂未支持" });
      });
    },
    [store, toastStore],
  );
  const handleDelete = useCallback((id: string) => {
    setDeleteTarget(id);
  }, []);

  // 执行删除：期间确认框保持打开并显示 loading，结束再关闭；成功/失败分别 toast。
  const handleDeleteConfirm = async (): Promise<void> => {
    if (deleteTarget === undefined) return;
    const target = deleteTarget;
    setDeleteBusy(true);
    try {
      await store.deleteConversation(target);
      toastStore.push({ kind: "success", text: "会话已删除" });
    } catch {
      toastStore.push({ kind: "danger", text: "删除失败，请重试" });
    } finally {
      setDeleteBusy(false);
      closeDialogs();
    }
  };

  return (
    <>
      <div className={styles.listSection}>
        <div className={dirStyles.searchBox}>
          <Icon icon={Search} size="xs" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索对话…"
            aria-label="搜索对话"
          />
        </div>
        {snapshot.conversations.length === 0 ? (
          <div className={styles.empty}>暂无对话 · 点击上方创建</div>
        ) : filtered.length === 0 ? (
          <div className={styles.empty}>没有匹配「{query.trim()}」的对话</div>
        ) : (
          groups.map((group) => (
            <div key={group.label} className={styles.group}>
              <div className={dirStyles.groupHead}>
                {group.label}
                <span className={dirStyles.count}>{group.items.length}</span>
              </div>
              <ConversationList
                conversations={group.items}
                activeId={snapshot.activeConversationId}
                onSelect={onSelect}
                onRename={handleRename}
                onPin={handlePin}
                onDelete={handleDelete}
              />
            </div>
          ))
        )}
      </div>
      <ConversationDialogs
        renameTarget={renameTarget}
        deleteTarget={deleteTarget}
        renameValue={renameValue}
        deleteBusy={deleteBusy}
        onRenameValueChange={setRenameValue}
        onRenameConfirm={() => {
          if (renameTarget === undefined) return;
          const next = renameValue.trim();
          if (next !== "") {
            void store.renameConversation(renameTarget.id, next).catch(() => {
              toastStore.push({ kind: "danger", text: "重命名失败，请重试" });
            });
          }
          closeDialogs();
        }}
        onDeleteConfirm={handleDeleteConfirm}
        onClose={closeDialogs}
      />
    </>
  );
}
