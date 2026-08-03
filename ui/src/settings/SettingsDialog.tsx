/** Shared Settings dialog consuming built-in and extension-contributed sections. */
import { useSyncExternalStore } from "react";
import type { NovelSettingsSection } from "../extensions/index.js";
import type { SidebarMode } from "../state/index.js";
import type { ApplicationSettingsStore } from "./ApplicationSettingsStore.js";

export interface SettingsDialogProps {
  readonly open: boolean;
  readonly store: ApplicationSettingsStore;
  readonly sections?: readonly NovelSettingsSection[];
  readonly onSidebarModeChange?: (mode: SidebarMode) => void;
  readonly onDismiss: () => void;
}

export function SettingsDialog({
  open,
  store,
  sections = [],
  onSidebarModeChange,
  onDismiss,
}: SettingsDialogProps) {
  const snapshot = useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getSnapshot(),
    () => store.getSnapshot(),
  );
  if (!open) return null;
  const updateSidebarMode = (mode: SidebarMode): void => {
    store.setSidebarMode(mode);
    onSidebarModeChange?.(mode);
  };
  return (
    <div className="novel-dialog-backdrop" role="presentation">
      <section
        aria-label="设置"
        aria-modal="true"
        className="novel-dialog novel-settings-dialog"
        role="dialog"
      >
        <header className="novel-dialog-header">
          <div>
            <span>Settings</span>
            <h2>设置</h2>
          </div>
          <button aria-label="关闭设置" onClick={onDismiss} type="button">
            ×
          </button>
        </header>
        <div className="novel-dialog-content novel-settings-content">
          <section className="novel-settings-section">
            <div>
              <h3>外观</h3>
              <p>设置当前窗口的默认侧栏状态。</p>
            </div>
            <label>
              <span>项目侧栏</span>
              <select
                aria-label="项目侧栏"
                onChange={(event) =>
                  updateSidebarMode(event.currentTarget.value as SidebarMode)
                }
                value={snapshot.sidebarMode}
              >
                <option value="expanded">展开</option>
                <option value="collapsed">收起</option>
              </select>
            </label>
          </section>
          {sections.map((section) => {
            const Section = section.component;
            return (
              <section className="novel-settings-section" key={section.id}>
                <h3>{section.title}</h3>
                <Section />
              </section>
            );
          })}
        </div>
        <footer className="novel-dialog-footer">
          <button onClick={onDismiss} type="button">
            完成
          </button>
        </footer>
      </section>
    </div>
  );
}
