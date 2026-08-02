/** Safe connection progress, failure, and explicit reconnect presentation. */
import { useState } from "react";
import type { ConversationProjectionBindingSnapshot } from "../ConversationProjectionBindingTypes.js";

export interface ConversationConnectionStatusProps {
  readonly snapshot: ConversationProjectionBindingSnapshot;
  resume(): Promise<void>;
}

const STATE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  idle: "等待连接",
  opening: "正在打开对话",
  active: "正在连接",
  starting: "正在连接",
  replaying: "正在恢复历史",
  following: "正在同步最新事件",
  live: "已连接",
  disconnected: "连接已断开",
  failed: "连接失败",
  stopping: "正在关闭",
  stopped: "已关闭",
});

export function ConversationConnectionStatus({
  snapshot,
  resume,
}: ConversationConnectionStatusProps) {
  const [resumePending, setResumePending] = useState(false);
  const state = snapshot.controller?.state ?? snapshot.state;
  const label = STATE_LABELS[state] ?? "状态未知";
  const disconnected = state === "disconnected";
  const failed = state === "failed" || snapshot.state === "failed";

  async function handleResume(): Promise<void> {
    if (!disconnected || resumePending) return;
    setResumePending(true);
    try {
      await resume();
    } catch {
      // Controller snapshots expose the redacted terminal failure to the UI.
    } finally {
      setResumePending(false);
    }
  }

  return (
    <div
      className="novel-connection-status"
      data-connection-state={state}
      role={disconnected || failed ? "alert" : "status"}
    >
      <span>{resumePending ? "正在重新连接" : label}</span>
      {snapshot.error !== undefined ? (
        <code className="novel-connection-error-code">{snapshot.error.code}</code>
      ) : null}
      {disconnected ? (
        <button
          className="novel-connection-action"
          type="button"
          disabled={resumePending}
          onClick={() => void handleResume()}
        >
          重新连接
        </button>
      ) : null}
    </div>
  );
}
