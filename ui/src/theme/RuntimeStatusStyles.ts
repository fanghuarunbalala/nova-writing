/**
 * Runtime status bar styling: animated gradient for active states, distinct
 * solid colors for configuration and failure states.
 */
export const RUNTIME_STATUS_STYLES = `
.novel-runtime-status-anchor {
  position: sticky;
  bottom: 0;
  z-index: 5;
  padding: 8px 0 4px;
  background: var(--novel-surface-primary);
}

.novel-runtime-status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 5px 12px;
  border: 1px solid var(--novel-border-strong);
  border-radius: 8px;
  color: var(--novel-text-primary);
  background: var(--novel-surface-secondary);
  font-size: 12px;
}

.novel-runtime-status-bar[data-runtime-status="starting"],
.novel-runtime-status-bar[data-runtime-status="generating"] {
  border-color: var(--novel-border-strong);
  background-color: var(--novel-surface-secondary);
  background-image: linear-gradient(90deg, #5f718a, #8ba0c4, #5f718a);
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: novel-runtime-gradient-text 2.4s linear infinite;
}

.novel-runtime-status-bar[data-runtime-status="generating"] {
  background-image: linear-gradient(90deg, #4f7fb0, #8a6fc4, #4f7fb0);
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  animation-duration: 1.6s;
}

.novel-runtime-status-bar[data-runtime-status="online"] {
  border-color: #bcd8c4;
  color: #1f6f43;
  background: #eef6f0;
}

.novel-runtime-status-bar[data-runtime-status="stopped"] {
  color: #5b6472;
  background: #f2f3f5;
}

.novel-runtime-status-bar[data-runtime-status="not_configured"],
.novel-runtime-status-bar[data-runtime-status="invalid_configuration"],
.novel-runtime-status-bar[data-runtime-status="missing_credential"],
.novel-runtime-status-bar[data-runtime-status="missing_manifest"] {
  border-color: #e8d3a8;
  color: #8a5b14;
  background: #fdf6ec;
}

.novel-runtime-status-bar[data-runtime-status="crashed"] {
  border-color: #e5b8b8;
  color: #8a2f2f;
  background: #fdf0f0;
}

.novel-runtime-status-bar .novel-runtime-status-code {
  color: inherit;
  opacity: 0.85;
  font-size: 11px;
}

.novel-runtime-status-bar .novel-connection-action {
  margin-left: auto;
  border: 1px solid currentColor;
  border-radius: 6px;
  padding: 3px 9px;
  color: inherit;
  background: rgb(255 255 255 / 0.14);
  font: inherit;
  cursor: pointer;
}

.novel-runtime-status-bar[data-runtime-status="starting"] .novel-connection-action,
.novel-runtime-status-bar[data-runtime-status="generating"] .novel-connection-action {
  border-color: var(--novel-border-strong);
  color: var(--novel-text-primary);
  background: var(--novel-surface-quiet);
}

@keyframes novel-runtime-gradient-text {
  0% {
    background-position: 0% 50%;
  }
  100% {
    background-position: 200% 50%;
  }
}
`;
