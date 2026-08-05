/** Refined thinking block with a three-line preview and expand toggle. */
export const THINKING_BLOCK_STYLES = `
.novel-thinking-block {
  margin: 8px 0 10px;
  border: 1px solid #e6e9f0;
  border-radius: 12px;
  background: linear-gradient(180deg, #f8fafd 0%, #f2f5fa 100%);
  padding: 10px 12px 12px;
}

.novel-thinking-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 7px;
  border: 0;
  padding: 0;
  color: #5b6472;
  background: transparent;
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
}

.novel-thinking-toggle::before {
  content: "✦";
  color: #8a94a6;
  font-size: 11px;
  line-height: 1;
}

.novel-thinking-toggle:focus-visible {
  outline: 2px solid var(--novel-focus);
  outline-offset: 1px;
  border-radius: 4px;
}

.novel-thinking-chevron {
  width: 18px;
  height: 18px;
  margin-left: auto;
  display: grid;
  place-items: center;
  border: 1px solid #dde2ea;
  border-radius: 50%;
  color: #7c8698;
  background: #ffffff;
  font-size: 11px;
  line-height: 1;
  transition: transform 0.18s ease, color 0.18s ease;
}

.novel-thinking-block[data-expanded="true"] .novel-thinking-chevron {
  transform: rotate(90deg);
}

.novel-thinking-content {
  margin-top: 7px;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.novel-thinking-content.collapsed {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  -webkit-mask-image: linear-gradient(
    to bottom,
    #000 55%,
    transparent 100%
  );
  mask-image: linear-gradient(to bottom, #000 55%, transparent 100%);
}
`;
