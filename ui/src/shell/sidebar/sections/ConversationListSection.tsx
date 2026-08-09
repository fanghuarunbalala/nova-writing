/**
 * ConversationListSection
 *
 * 对话列表 section：把 catalog 项映射为列表行。
 * 重命名/删除弹窗状态本地持有（G7：以自定义 Dialog 替代原生 prompt/confirm，
 * 后者在 Electron 渲染进程不可用或不一致）。
 */
import { useState } from "react";
import { ConversationList } from "../../../domains/conversation/components/ConversationList.js";
import {
  ConversationDialogs,
  type RenameTarget,
} from "../../../domains/conversation/components/ConversationDialogs.js";
import type { ConversationCatalogStore } from "../../../domains/conversation/store/ConversationCatalogStore.js";
import { useExternalStore } from "../../../shared/state/useExternalStore.js";
import styles from "./ConversationListSection.module.css";

export interface ConversationListSectionProps {
  readonly store: ConversationCatalogStore;
  readonly onSelect: (id: string) => void;
}

export function ConversationListSection({ store, onSelect }: ConversationListSectionProps) {
  const snapshot = useExternalStore(store);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | undefined>(undefined);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<string | undefined>(undefined);

  const closeDialogs = (): void => {
    setRenameTarget(undefined);
    setRenameValue("");
    setDeleteTarget(undefined);
  };

  if (snapshot.conversations.length === 0) {
    return <div className={styles.empty}>暂无对话 · 点击上方创建</div>;
  }
  return (
    <>
      <ConversationList
        conversations={snapshot.conversations.map((item) => ({
          id: item.id,
          title: item.title,
          agentLabel: item.agentLabel,
          lastActivityAt: item.lastActivityAt,
          ...(item.pinned === undefined ? {} : { pinned: item.pinned }),
          ...(item.status === undefined ? {} : { status: item.status }),
        }))}
        activeId={snapshot.activeConversationId}
        onSelect={onSelect}
        onRename={(id) => {
          const current =
            snapshot.conversations.find((item) => item.id === id)?.title ?? "";
          setRenameValue(current);
          setRenameTarget({ id, title: current });
        }}
        onPin={(id, pinned) => {
          void store.pinConversation(id, pinned);
        }}
        onDelete={(id) => {
          setDeleteTarget(id);
        }}
      />
      <ConversationDialogs
        renameTarget={renameTarget}
        deleteTarget={deleteTarget}
        renameValue={renameValue}
        onRenameValueChange={setRenameValue}
        onRenameConfirm={() => {
          if (renameTarget === undefined) return;
          const next = renameValue.trim();
          if (next !== "") {
            void store.renameConversation(renameTarget.id, next);
          }
          closeDialogs();
        }}
        onDeleteConfirm={() => {
          if (deleteTarget !== undefined) {
            void store.deleteConversation(deleteTarget);
          }
          closeDialogs();
        }}
        onClose={closeDialogs}
      />
    </>
  );
}
