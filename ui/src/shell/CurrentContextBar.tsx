/** Persistent Workspace context summary. */
import type { SidebarMode } from "../state/index.js";
import { SidebarToggleButton } from "./SidebarToggleButton.js";

export interface CurrentContextBarProps {
  readonly workspace?: string;
  readonly meta?: string;
  readonly conversation?: string;
  readonly agent?: string;
  readonly onWorkspaceSelect?: () => void;
  readonly sidebarMode?: SidebarMode;
  readonly onToggleSidebar?: () => void;
}

const EMPTY_VALUE = "未选择";

export function CurrentContextBar(props: CurrentContextBarProps) {
  const value = props.workspace ?? EMPTY_VALUE;
  return (
    <div className="novel-context-bar" aria-label="当前工作上下文">
      <span className="novel-context-segment">
        <span className="novel-context-label">Workspace</span>
        {props.onWorkspaceSelect !== undefined ? (
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
      {props.sidebarMode !== undefined ? (
        <span className="novel-context-actions">
          <SidebarToggleButton
            mode={props.sidebarMode}
            onToggle={props.onToggleSidebar}
          />
        </span>
      ) : null}
    </div>
  );
}
