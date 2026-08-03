/** Central Conversation host with a reserved Composer surface. */
import type { ReactNode } from "react";

export interface ConversationWorkspaceProps {
  readonly children?: ReactNode;
  readonly composer?: ReactNode;
  readonly emptyState?: ReactNode;
}

export function ConversationWorkspace({
  children,
  composer,
  emptyState,
}: ConversationWorkspaceProps) {
  return (
    <main className="novel-conversation-workspace" aria-label="对话工作区">
      <div className="novel-conversation-content">
        {children ??
          emptyState ?? (
            <div className="novel-conversation-empty">选择或新建一个对话</div>
          )}
      </div>
      <div className="novel-composer-host" aria-label="消息输入区">
        {composer ?? (
          <div className="novel-composer-placeholder">在这里输入你的想法…</div>
        )}
      </div>
    </main>
  );
}
