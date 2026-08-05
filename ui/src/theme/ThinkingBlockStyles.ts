/** Cloud-like thinking block with a three-line preview and expand toggle. */
export const THINKING_BLOCK_STYLES = `
.novel-thinking-block {
  margin: 6px 0;
  border: 1px solid var(--novel-border);
  border-radius: 16px 22px 18px 14px / 20px 14px 16px 22px;
  background: var(--novel-surface-secondary);
  padding: 8px 12px;
}

.novel-thinking-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border: 0;
  padding: 0;
  color: var(--novel-text-secondary);
  background: transparent;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.novel-thinking-toggle:hover {
  color: var(--novel-text-primary);
}

.novel-thinking-toggle:focus-visible {
  outline: 2px solid var(--novel-focus);
  outline-offset: 1px;
  border-radius: 4px;
}

.novel-thinking-icon {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border: 1px solid var(--novel-border-strong);
  border-radius: 50%;
  color: var(--novel-text-secondary);
  background: var(--novel-surface-primary);
  font-size: 11px;
  line-height: 1;
}

.novel-thinking-content {
  color: var(--novel-text-secondary);
  font-size: 12px;
  line-height: 1.65;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.novel-thinking-content.collapsed {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.novel-thinking-content.expanded {
  margin-top: 6px;
}
`;
