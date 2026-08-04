/** Desktop Runtime status token with safe retry, stop, and settings actions. */
import type { ConversationRuntimeStatus } from "@novel/core";

export interface ConversationRuntimeStatusViewProps {
  readonly status: ConversationRuntimeStatus;
  readonly failureCode?: string;
  readonly onRetry?: () => void;
  readonly onStop?: () => void;
  readonly onOpenSettings?: () => void;
}

const STATUS_LABELS: Readonly<Record<ConversationRuntimeStatus, string>> =
  Object.freeze({
    not_configured: "未配置",
    invalid_configuration: "配置无效",
    missing_credential: "缺少凭据",
    missing_manifest: "缺少 Agent 清单",
    starting: "启动中",
    online: "在线",
    generating: "生成中",
    stopped: "已停止",
    crashed: "已崩溃",
  });

const FAILURE_STATUSES: ReadonlySet<ConversationRuntimeStatus> = new Set([
  "not_configured",
  "invalid_configuration",
  "missing_credential",
  "missing_manifest",
  "crashed",
]);

export function ConversationRuntimeStatusView({
  status,
  failureCode,
  onRetry,
  onStop,
  onOpenSettings,
}: ConversationRuntimeStatusViewProps) {
  const isFailure = FAILURE_STATUSES.has(status);
  const label = STATUS_LABELS[status] ?? "状态未知";
  return (
    <div
      className="novel-connection-status"
      data-runtime-status={status}
      role={isFailure ? "alert" : "status"}
    >
      <span>{label}</span>
      {failureCode !== undefined ? (
        <code className="novel-connection-error-code">{failureCode}</code>
      ) : null}
      {isFailure && onRetry !== undefined ? (
        <button
          className="novel-connection-action"
          type="button"
          onClick={onRetry}
        >
          重试
        </button>
      ) : null}
      {status === "generating" && onStop !== undefined ? (
        <button
          className="novel-connection-action"
          type="button"
          onClick={onStop}
        >
          停止
        </button>
      ) : null}
      {isFailure && onOpenSettings !== undefined ? (
        <button
          className="novel-connection-action"
          type="button"
          onClick={onOpenSettings}
        >
          打开设置
        </button>
      ) : null}
    </div>
  );
}
