/** Persistent Workspace, Meta, Conversation, and Agent context summary. */
export interface CurrentContextBarProps {
  readonly workspace?: string;
  readonly meta?: string;
  readonly conversation?: string;
  readonly agent?: string;
  readonly onWorkspaceSelect?: () => void;
}

const EMPTY_VALUE = "未选择";

export function CurrentContextBar(props: CurrentContextBarProps) {
  const segments = [
    ["Workspace", props.workspace ?? EMPTY_VALUE],
    ["Meta", props.meta ?? EMPTY_VALUE],
    ["Conversation", props.conversation ?? EMPTY_VALUE],
    ["Agent", props.agent ?? EMPTY_VALUE],
  ] as const;
  return (
    <div className="novel-context-bar" aria-label="当前工作上下文">
      {segments.map(([label, value], index) => (
        <span className="novel-context-segment" key={label}>
          {index > 0 ? (
            <span className="novel-context-divider" aria-hidden="true">
              /
            </span>
          ) : null}
          <span className="novel-context-label">{label}</span>
          {label === "Workspace" && props.onWorkspaceSelect !== undefined ? (
            <button
              className="novel-context-value novel-context-workspace-button"
              onClick={props.onWorkspaceSelect}
              title={value}
              type="button"
            >
              {value}
            </button>
          ) : (
            <span className="novel-context-value" title={value}>
              {value}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}
