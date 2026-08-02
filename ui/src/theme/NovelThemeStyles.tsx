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
