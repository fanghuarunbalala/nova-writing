/** Shared Settings dialog consuming built-in and extension-contributed sections. */
import { useEffect, useState } from "react";
import type { NovelSettingsSection } from "../extensions/index.js";
import type { ApplicationSettingsStore } from "./ApplicationSettingsStore.js";
import type { ApplicationConfigurationClient } from "./ApplicationConfigurationClient.js";
import { ModelProviderSettingsPanel } from "./ModelProviderSettingsPanel.js";

export interface SettingsDialogProps {
  readonly open: boolean;
  readonly store: ApplicationSettingsStore;
  readonly sections?: readonly NovelSettingsSection[];
  readonly configuration?: ApplicationConfigurationClient;
  readonly onDismiss: () => void;
}

export function SettingsDialog({
  open,
  store,
  sections = [],
  configuration,
  onDismiss,
}: SettingsDialogProps) {
  const [activeSectionId, setActiveSectionId] = useState("models");
  useEffect(() => {
    if (open) setActiveSectionId("models");
  }, [open]);
  if (!open) return null;
  const extensionSection = sections.find(
    (section) => section.id === activeSectionId,
  );
  const ExtensionSection = extensionSection?.component;
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
        <div className="novel-dialog-content novel-settings-layout">
          <nav aria-label="设置分类" className="novel-settings-sidebar">
            <button
              data-active={activeSectionId === "models"}
              onClick={() => setActiveSectionId("models")}
              type="button"
            >
              模型
            </button>
            {sections.map((section) => (
              <button
                data-active={activeSectionId === section.id}
                key={section.id}
                onClick={() => setActiveSectionId(section.id)}
                type="button"
              >
                {section.title}
              </button>
            ))}
          </nav>
          <div className="novel-settings-content">
            {activeSectionId === "models" ? (
              <ModelProviderSettingsPanel
                store={store}
                configuration={configuration}
              />
            ) : null}
            {extensionSection !== undefined && ExtensionSection !== undefined ? (
              <section className="novel-settings-section">
                <h3>{extensionSection.title}</h3>
                <ExtensionSection />
              </section>
            ) : null}
          </div>
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
