/** Injects the initial quiet white shared-application theme. */
export function NovelThemeStyles() {
  return <style data-novel-theme="quiet-white">{NOVEL_THEME_CSS}</style>;
}

const NOVEL_THEME_CSS = `
:root {
  --novel-surface-primary: #ffffff;
  --novel-surface-secondary: #f7f8fa;
  --novel-surface-quiet: #fafafa;
  --novel-border: #e5e7eb;
  --novel-border-strong: #d1d5db;
  --novel-text-primary: #20242a;
  --novel-text-secondary: #6b7280;
  --novel-accent: #5f718a;
  --novel-focus: #4f6b91;
  --novel-radius: 8px;
  --novel-font: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.novel-app-shell,
.novel-app-shell * {
  box-sizing: border-box;
}

.novel-app-shell {
  min-width: 760px;
  min-height: 100vh;
  display: grid;
  grid-template-rows: auto 40px 38px minmax(0, 1fr);
  overflow: hidden;
  color: var(--novel-text-primary);
  background: var(--novel-surface-primary);
  font-family: var(--novel-font);
}

.novel-titlebar-extension:empty {
  display: none;
}

.novel-top-menu,
.novel-context-bar {
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--novel-border);
  background: var(--novel-surface-primary);
}

.novel-top-menu {
  gap: 4px;
  padding: 0 12px;
}

.novel-menu-button,
.novel-sidebar-button {
  border: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: default;
}

.novel-menu-button {
  height: 30px;
  padding: 0 10px;
  border-radius: 6px;
  font-size: 13px;
}

.novel-menu-button:hover,
.novel-sidebar-button:hover {
  background: var(--novel-surface-secondary);
}

.novel-menu-button:focus-visible,
.novel-sidebar-button:focus-visible {
  outline: 2px solid var(--novel-focus);
  outline-offset: -2px;
}

.novel-context-bar {
  gap: 8px;
  padding: 0 16px;
  color: var(--novel-text-secondary);
  font-size: 12px;
}

.novel-context-segment {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 5px;
}

.novel-context-label {
  color: #8b929d;
}

.novel-context-value {
  max-width: 220px;
  overflow: hidden;
  color: var(--novel-text-primary);
  font-weight: 550;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.novel-context-divider {
  color: var(--novel-border-strong);
}

.novel-shell-body {
  min-height: 0;
  display: grid;
  grid-template-columns: 244px minmax(360px, 1fr) 0;
  overflow: hidden;
}

.novel-shell-body[data-inspector-mode="normal"] {
  grid-template-columns: 244px minmax(360px, 1fr) minmax(320px, 34vw);
}

.novel-shell-body[data-inspector-mode="expanded"] {
  grid-template-columns: 244px minmax(320px, 0.72fr) minmax(520px, 1.28fr);
}

.novel-shell-body[data-sidebar-mode="collapsed"] {
  grid-template-columns: 64px minmax(360px, 1fr) 0;
}

.novel-shell-body[data-sidebar-mode="collapsed"][data-inspector-mode="normal"] {
  grid-template-columns: 64px minmax(360px, 1fr) minmax(320px, 34vw);
}

.novel-shell-body[data-sidebar-mode="collapsed"][data-inspector-mode="expanded"] {
  grid-template-columns: 64px minmax(320px, 0.72fr) minmax(520px, 1.28fr);
}

.novel-project-sidebar {
  min-height: 0;
  overflow: auto;
  border-right: 1px solid var(--novel-border);
  background: var(--novel-surface-secondary);
  padding: 12px 10px;
}

.novel-sidebar-section + .novel-sidebar-section {
  margin-top: 18px;
}

.novel-sidebar-heading {
  margin: 0 8px 7px;
  color: var(--novel-text-secondary);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.novel-sidebar-button {
  width: 100%;
  min-height: 34px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 9px;
  border-radius: 7px;
  font-size: 13px;
}

.novel-sidebar-button[data-active="true"] {
  background: #edf1f6;
  font-weight: 600;
}

.novel-sidebar-marker {
  width: 18px;
  color: var(--novel-accent);
  text-align: center;
}

.novel-project-sidebar[data-sidebar-mode="collapsed"] .novel-sidebar-heading,
.novel-project-sidebar[data-sidebar-mode="collapsed"] .novel-sidebar-label {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.novel-project-sidebar[data-sidebar-mode="collapsed"] .novel-sidebar-button {
  justify-content: center;
}

.novel-conversation-workspace {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  background: var(--novel-surface-primary);
}

.novel-conversation-content {
  min-height: 0;
  overflow: auto;
  padding: 24px clamp(20px, 5vw, 72px);
}

.novel-conversation-empty {
  height: 100%;
  display: grid;
  place-items: center;
  color: var(--novel-text-secondary);
  font-size: 14px;
}

.novel-composer-host {
  border-top: 1px solid var(--novel-border);
  padding: 14px clamp(20px, 5vw, 72px) 18px;
  background: var(--novel-surface-primary);
}

.novel-composer-placeholder {
  min-height: 48px;
  display: flex;
  align-items: center;
  padding: 0 14px;
  border: 1px solid var(--novel-border-strong);
  border-radius: var(--novel-radius);
  color: #9aa1aa;
  background: var(--novel-surface-quiet);
  font-size: 13px;
}

.novel-inspector-host {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  border-left: 1px solid var(--novel-border);
  background: var(--novel-surface-quiet);
}

.novel-inspector-host[data-inspector-mode="closed"] {
  visibility: hidden;
  border-left: 0;
}

.novel-inspector-panel {
  min-height: 100%;
  padding: 18px;
  color: var(--novel-text-primary);
  background: var(--novel-surface-quiet);
}

.novel-inspector-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  border-bottom: 1px solid var(--novel-border);
  padding-bottom: 14px;
}

.novel-inspector-heading span {
  color: var(--novel-text-secondary);
  font-size: 11px;
  text-transform: uppercase;
}

.novel-inspector-heading h2 {
  margin: 4px 0 0;
  font-size: 17px;
  font-weight: 600;
}

.novel-inspector-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.novel-inspector-actions button {
  border: 1px solid var(--novel-border-strong);
  border-radius: 6px;
  padding: 5px 8px;
  color: var(--novel-text-primary);
  background: var(--novel-surface-primary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.novel-inspector-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.novel-inspector-actions button:focus-visible {
  outline: 2px solid var(--novel-focus);
  outline-offset: 1px;
}

.novel-inspector-status,
.novel-inspector-empty {
  margin: 14px 0 0;
  color: var(--novel-text-secondary);
  font-size: 13px;
}

.novel-inspector-status[data-status="error"],
.novel-inspector-status[data-status="unavailable"] {
  color: #8a4141;
}

.novel-inspector-content {
  padding-top: 16px;
}

.novel-outline-tree-panel {
  color: var(--novel-text-primary);
}

.novel-outline-tree-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 12px;
}

.novel-outline-tree-header span,
.novel-outline-scope {
  color: var(--novel-text-secondary);
  font-size: 11px;
}

.novel-outline-tree-header h3 {
  margin: 3px 0 0;
  font-size: 16px;
}

.novel-outline-scope {
  border: 1px solid var(--novel-border);
  border-radius: 999px;
  padding: 3px 8px;
  background: var(--novel-surface-primary);
}

.novel-outline-tree {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.novel-outline-row {
  min-width: 0;
  display: flex;
  align-items: flex-start;
  gap: 5px;
  border-radius: 7px;
  padding: 7px 8px 7px calc(8px + var(--novel-outline-indent));
  cursor: default;
}

.novel-outline-row:hover {
  background: var(--novel-surface-secondary);
}

.novel-outline-row[data-selected="true"] {
  background: #e8edf3;
}

.novel-outline-row:focus-visible {
  outline: 2px solid var(--novel-focus);
  outline-offset: -2px;
}

.novel-outline-toggle {
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  border: 0;
  padding: 0;
  color: var(--novel-text-secondary);
  background: transparent;
  cursor: pointer;
}

.novel-outline-toggle:disabled {
  cursor: default;
  opacity: 0.55;
}

.novel-outline-row-main {
  min-width: 0;
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
}

.novel-outline-title {
  min-width: 120px;
  flex: 1 1 180px;
  overflow-wrap: anywhere;
  line-height: 1.45;
}

.novel-outline-statuses {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.novel-outline-badge,
.novel-outline-progress {
  border: 1px solid var(--novel-border);
  border-radius: 999px;
  padding: 2px 6px;
  color: var(--novel-text-secondary);
  background: var(--novel-surface-primary);
  font-size: 10px;
  white-space: nowrap;
}

.novel-outline-badge[data-badge-kind="planning"] {
  color: #556c85;
  background: #f4f7fa;
}

.novel-outline-badge[data-badge-kind="realization"] {
  color: #526b5d;
  background: #f4f8f5;
}

.novel-outline-badge[data-badge-kind="blocked"] {
  border-color: #e2c7c7;
  color: #8a4141;
  background: #fff8f8;
}

.novel-outline-empty {
  color: var(--novel-text-secondary);
  font-size: 13px;
}

.novel-change-review {
  color: var(--novel-text-primary);
}

.novel-change-review-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid var(--novel-border);
  padding-bottom: 14px;
}

.novel-change-review-header > div > span {
  color: var(--novel-text-secondary);
  font-size: 11px;
}

.novel-change-review-header h2 {
  margin: 4px 0 0;
  font-size: 18px;
}

.novel-change-review-header p {
  margin: 7px 0 0;
  color: var(--novel-text-secondary);
  line-height: 1.5;
}

.novel-change-review-state {
  flex: 0 0 auto;
  border: 1px solid var(--novel-border);
  border-radius: 999px;
  padding: 4px 8px;
  color: var(--novel-text-secondary);
  background: var(--novel-surface-primary);
  font-size: 11px;
}

.novel-change-review-state[data-state="stale"],
.novel-change-review-state[data-state="conflict"],
.novel-change-review-state[data-state="unavailable"],
.novel-change-review-state[data-state="error"] {
  border-color: #e2c7c7;
  color: #8a4141;
  background: #fff8f8;
}

.novel-change-review-identity {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 14px 0 0;
}

.novel-change-review-identity div {
  min-width: 0;
  border: 1px solid var(--novel-border);
  border-radius: 7px;
  padding: 8px 10px;
  background: var(--novel-surface-primary);
}

.novel-change-review-identity dt {
  color: var(--novel-text-secondary);
  font-size: 10px;
}

.novel-change-review-identity dd {
  margin: 4px 0 0;
  overflow: hidden;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.novel-change-review-notice {
  margin: 12px 0 0;
  border-radius: 7px;
  padding: 9px 10px;
  color: var(--novel-text-secondary);
  background: var(--novel-surface-secondary);
  font-size: 12px;
}

.novel-change-review-notice[data-notice-kind="stale"],
.novel-change-review-notice[data-notice-kind="conflict"],
.novel-change-review-notice[data-notice-kind="unavailable"],
.novel-change-review-notice[data-notice-kind="error"] {
  color: #8a4141;
  background: #fff8f8;
}

.novel-change-review-content {
  padding-top: 16px;
}

.novel-change-review-footer {
  margin-top: 16px;
  border-top: 1px solid var(--novel-border);
  padding-top: 12px;
  color: var(--novel-text-secondary);
  font-size: 11px;
}

.novel-entity-change-reviewer > header > span {
  color: var(--novel-text-secondary);
  font-size: 11px;
}

.novel-entity-change-reviewer > header > h3 {
  margin: 4px 0 12px;
  font-size: 16px;
}

.novel-entity-field-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.novel-entity-field-diff {
  border: 1px solid var(--novel-border);
  border-radius: 8px;
  padding: 10px;
  background: var(--novel-surface-primary);
}

.novel-entity-field-diff > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.novel-entity-field-diff h4 {
  margin: 0;
  font-size: 13px;
}

.novel-entity-field-diff > header span,
.novel-entity-field-value > span {
  color: var(--novel-text-secondary);
  font-size: 10px;
}

.novel-entity-field-replacement {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.novel-entity-field-value {
  border-radius: 6px;
  padding: 8px 9px;
  background: var(--novel-surface-quiet);
}

.novel-entity-field-value[data-value-tone="added"] {
  border: 1px solid #bcd8c3;
  background: #eff8f1;
}

.novel-entity-field-value[data-value-tone="removed"] {
  border: 1px solid #e2c1c1;
  background: #fff0f0;
}

.novel-entity-field-value[data-value-tone="unchanged"] {
  border: 1px solid var(--novel-border);
  background: var(--novel-surface-quiet);
}

.novel-entity-field-value p,
.novel-entity-field-value ul {
  margin: 4px 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.novel-entity-field-value ul {
  padding-left: 18px;
}

.novel-entity-evidence {
  margin-top: 16px;
  border-top: 1px solid var(--novel-border);
  padding-top: 14px;
}

.novel-entity-evidence > h4,
.novel-entity-evidence > p {
  margin: 0 0 7px;
}

.novel-entity-evidence > p,
.novel-entity-evidence small {
  color: var(--novel-text-secondary);
  font-size: 11px;
}

.novel-entity-evidence article {
  margin-top: 8px;
  border: 1px solid var(--novel-border);
  border-radius: 7px;
  padding: 9px 10px;
  background: var(--novel-surface-quiet);
}

.novel-entity-evidence article header {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.novel-entity-evidence article p {
  margin: 6px 0;
}

.novel-outline-diff-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}

.novel-outline-diff-legend span,
.novel-outline-diff-status span {
  border: 1px solid var(--novel-border);
  border-radius: 999px;
  padding: 2px 6px;
  color: var(--novel-text-secondary);
  background: var(--novel-surface-primary);
  font-size: 10px;
}

.novel-outline-diff-tree {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.novel-outline-diff-row {
  display: flex;
  gap: 6px;
  border: 1px solid var(--novel-border);
  border-radius: 7px;
  padding: 8px 9px 8px calc(9px + var(--novel-outline-diff-indent));
  background: var(--novel-surface-primary);
}

.novel-outline-diff-row[data-diff-kind="added"],
.novel-outline-diff-row[data-diff-kind="modified-after"] {
  border-color: #bcd8c3;
  background: #eff8f1;
}

.novel-outline-diff-row[data-diff-kind="deleted"],
.novel-outline-diff-row[data-diff-kind="modified-before"] {
  border-color: #e2c1c1;
  background: #fff0f0;
}

.novel-outline-diff-row[data-diff-kind="deleted"] .novel-outline-diff-main strong {
  text-decoration: line-through;
}

.novel-outline-diff-row[data-diff-kind="moved"] {
  border-color: #bfd0e4;
  background: #f0f5fb;
}

.novel-outline-diff-row[data-selected="true"] {
  outline: 2px solid var(--novel-focus);
  outline-offset: -2px;
}

.novel-outline-diff-toggle {
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
  border: 0;
  padding: 0;
  color: var(--novel-text-secondary);
  background: transparent;
}

.novel-outline-diff-main {
  min-width: 0;
  flex: 1;
}

.novel-outline-diff-main > header {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.novel-outline-diff-main > header span {
  color: var(--novel-text-secondary);
  font-size: 10px;
}

.novel-outline-diff-status {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}

.novel-outline-move-path {
  margin: 7px 0 0;
  color: #55708f;
  font-size: 11px;
}

.novel-manuscript-diff-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}

.novel-manuscript-diff-legend span {
  border: 1px solid var(--novel-border);
  border-radius: 999px;
  padding: 2px 6px;
  color: var(--novel-text-secondary);
  background: var(--novel-surface-primary);
  font-size: 10px;
}

.novel-manuscript-diff-blocks {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.novel-manuscript-diff-block {
  border: 1px solid var(--novel-border);
  border-radius: 8px;
  padding: 10px 12px;
  background: var(--novel-surface-primary);
}

.novel-manuscript-diff-block[data-diff-kind="added"],
.novel-manuscript-diff-block[data-diff-kind="modified-after"] {
  border-color: #bcd8c3;
  background: #eff8f1;
}

.novel-manuscript-diff-block[data-diff-kind="deleted"],
.novel-manuscript-diff-block[data-diff-kind="modified-before"] {
  border-color: #e2c1c1;
  background: #fff0f0;
}

.novel-manuscript-diff-block[data-diff-kind="deleted"] p {
  text-decoration: line-through;
}

.novel-manuscript-diff-block[data-diff-kind="moved"] {
  border-color: #bfd0e4;
  background: #f0f5fb;
}

.novel-manuscript-diff-block[data-selected="true"] {
  outline: 2px solid var(--novel-focus);
  outline-offset: -2px;
}

.novel-manuscript-diff-block header {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  color: var(--novel-text-secondary);
  font-size: 10px;
}

.novel-manuscript-diff-block p {
  margin: 8px 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.65;
}

.novel-manuscript-diff-block footer {
  margin-top: 8px;
  color: #55708f;
  font-size: 11px;
}

.novel-manuscript-inline-diff-note {
  margin: 12px 0 0;
  color: var(--novel-text-secondary);
  font-size: 11px;
}

.novel-conversation-view {
  width: min(840px, 100%);
  margin: 0 auto;
}

.novel-conversation-header,
.novel-message-header,
.novel-card-header {
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--novel-text-secondary);
  font-size: 12px;
}

.novel-conversation-header {
  justify-content: space-between;
  margin-bottom: 20px;
}

.novel-runtime-presence,
.novel-status-token,
.novel-card-status {
  border: 1px solid var(--novel-border);
  border-radius: 999px;
  padding: 2px 8px;
  background: var(--novel-surface-secondary);
}

.novel-connection-status {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  border: 1px solid var(--novel-border);
  border-radius: 8px;
  padding: 9px 11px;
  color: var(--novel-text-secondary);
  background: var(--novel-surface-secondary);
  font-size: 13px;
}

.novel-connection-status[data-connection-state="disconnected"],
.novel-connection-status[data-connection-state="failed"] {
  border-color: #e2c7c7;
  color: #7b4141;
  background: #fff8f8;
}

.novel-connection-error-code {
  font-size: 11px;
}

.novel-connection-action,
.novel-follow-latest {
  border: 1px solid var(--novel-border-strong);
  border-radius: 7px;
  padding: 6px 10px;
  color: var(--novel-text-primary);
  background: var(--novel-surface-primary);
  font: inherit;
  cursor: pointer;
}

.novel-connection-action {
  margin-left: auto;
}

.novel-follow-latest {
  position: sticky;
  bottom: 8px;
  align-self: center;
  box-shadow: 0 4px 14px rgb(32 36 42 / 12%);
}

.novel-connection-action:focus-visible,
.novel-follow-latest:focus-visible {
  outline: 2px solid var(--novel-focus);
  outline-offset: 2px;
}

.novel-conversation-timeline {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.novel-message {
  max-width: min(720px, 92%);
}

.novel-user-message {
  align-self: flex-end;
}

.novel-assistant-message {
  align-self: flex-start;
}

.novel-message-header {
  margin: 0 8px 6px;
}

.novel-message-text,
.novel-thinking-block,
.novel-message-notice {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.novel-user-message .novel-message-text {
  border-radius: 14px 14px 4px 14px;
  padding: 11px 14px;
  background: #edf1f6;
}

.novel-assistant-content {
  border-left: 2px solid var(--novel-border);
  padding: 4px 0 4px 14px;
  line-height: 1.65;
}

.novel-thinking-block {
  margin-top: 10px;
  color: var(--novel-text-secondary);
  font-size: 13px;
}

.novel-streaming-cursor {
  color: var(--novel-accent);
  animation: novel-pulse 1.1s ease-in-out infinite;
}

.novel-message-notice {
  color: #8a4b4b;
  font-size: 13px;
}

.novel-approval-card {
  width: min(620px, 100%);
  align-self: flex-start;
  border: 1px solid var(--novel-border);
  border-radius: 10px;
  padding: 14px 16px;
  background: var(--novel-surface-quiet);
}

.novel-conversation-card {
  width: min(620px, 100%);
  align-self: flex-start;
  border: 1px solid var(--novel-border);
  border-radius: 10px;
  padding: 14px 16px;
  background: var(--novel-surface-quiet);
}

.novel-conversation-card h3,
.novel-conversation-card p {
  margin: 8px 0 0;
}

.novel-conversation-card button {
  margin-top: 12px;
  border: 1px solid var(--novel-border-strong);
  border-radius: 7px;
  padding: 6px 10px;
  color: var(--novel-text-primary);
  background: var(--novel-surface-primary);
  font: inherit;
  cursor: pointer;
}

.novel-conversation-card button:focus-visible {
  outline: 2px solid var(--novel-focus);
  outline-offset: 1px;
}

.novel-approval-card h3,
.novel-approval-card p {
  margin: 8px 0 0;
}

.novel-card-status {
  width: fit-content;
  margin-top: 12px;
  color: #8a641e;
}

.novel-conversation-diagnostics {
  margin-top: 18px;
  color: var(--novel-text-secondary);
  font-size: 12px;
}

.novel-conversation-composer {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px 10px;
}

.novel-composer-references,
.novel-composer-reference-notice {
  grid-column: 1 / -1;
}

.novel-composer-references ul {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.novel-composer-references li {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  border: 1px solid #cad3df;
  border-radius: 999px;
  padding: 3px 5px 3px 8px;
  background: #f5f7fa;
  font-size: 11px;
}

.novel-composer-reference-kind {
  color: var(--novel-text-secondary);
}

.novel-composer-reference-label,
.novel-composer-reference-open {
  min-width: 0;
  overflow: hidden;
  color: var(--novel-text-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.novel-composer-reference-open,
.novel-composer-reference-remove {
  border: 0;
  padding: 0;
  background: transparent;
  font: inherit;
  cursor: pointer;
}

.novel-composer-reference-open:focus-visible,
.novel-composer-reference-remove:focus-visible {
  outline: 2px solid var(--novel-focus);
  outline-offset: 1px;
}

.novel-composer-reference-remove {
  border-radius: 999px;
  padding: 2px 5px;
  color: var(--novel-text-secondary);
}

.novel-composer-reference-remove:hover {
  color: #8a4141;
  background: #f9e8e8;
}

.novel-composer-reference-notice {
  margin: 0;
  color: #6f5b32;
  font-size: 12px;
}

.novel-reference-in-conversation {
  min-height: 32px;
  border: 1px solid #bac6d5;
  border-radius: 7px;
  padding: 0 10px;
  color: #405775;
  background: #f4f7fb;
  font: inherit;
  cursor: pointer;
}

.novel-reference-in-conversation:hover:not(:disabled) {
  border-color: #8fa2b9;
  background: #edf2f8;
}

.novel-reference-in-conversation:focus-visible {
  outline: 2px solid var(--novel-focus);
  outline-offset: 1px;
}

.novel-reference-in-conversation[data-reference-state="referenced"] {
  border-color: #bcd8c3;
  color: #3e6c49;
  background: #eff8f1;
}

.novel-reference-in-conversation[data-reference-state="conflict"],
.novel-reference-in-conversation[data-reference-state="unavailable"] {
  border-color: #e2c1c1;
  color: #8a4141;
  background: #fff0f0;
}

.novel-reference-in-conversation:disabled {
  cursor: not-allowed;
  opacity: 0.78;
}

.novel-conversation-composer textarea {
  min-height: 58px;
  max-height: 180px;
  resize: vertical;
  border: 1px solid var(--novel-border-strong);
  border-radius: var(--novel-radius);
  padding: 11px 13px;
  color: var(--novel-text-primary);
  background: var(--novel-surface-primary);
  font: inherit;
  line-height: 1.45;
}

.novel-conversation-composer textarea:focus-visible {
  outline: 2px solid var(--novel-focus);
  outline-offset: 1px;
}

.novel-composer-actions {
  display: flex;
  align-items: end;
  gap: 7px;
}

.novel-send-button,
.novel-stop-button {
  min-height: 36px;
  border: 1px solid var(--novel-border-strong);
  border-radius: 7px;
  padding: 0 12px;
  font: inherit;
  cursor: pointer;
}

.novel-send-button {
  border-color: #60738c;
  color: #ffffff;
  background: #60738c;
}

.novel-stop-button {
  color: var(--novel-text-primary);
  background: var(--novel-surface-primary);
}

.novel-send-button:disabled,
.novel-stop-button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.novel-composer-notice {
  grid-column: 1 / -1;
  margin: 0;
  color: var(--novel-text-secondary);
  font-size: 12px;
}

.novel-composer-notice[data-notice-kind="error"] {
  color: #8a4141;
}

@keyframes novel-pulse {
  50% { opacity: 0.35; }
}
`;
