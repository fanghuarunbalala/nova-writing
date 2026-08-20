/**
 * SettingsDialog
 *
 * 设置弹窗（基于共享 Dialog 原语）：左侧分类导航 + 右侧设置面板。
 * 内置"模型"与"外观"（主题选择）分类；扩展可通过 sections 注入额外分类。
 */
import { useEffect, useState } from "react";
import { Dialog } from "../shared/primitives/Dialog.js";
import { Button } from "../shared/primitives/Button.js";
import type { NovelSettingsSection } from "../extensions/index.js";
import type { ApplicationSettingsStore } from "./ApplicationSettingsStore.js";
import type { ApplicationConfigurationClient } from "./ApplicationConfigurationClient.js";
import { ModelProviderSettingsPanel } from "./ModelProviderSettingsPanel.js";
import { AgentSettingsPanel } from "./AgentSettingsPanel.js";
import { SkillsSettingsPanel } from "./SkillsSettingsPanel.js";
import { McpSettingsPanel } from "./McpSettingsPanel.js";
import { AppearanceSettingsPanel } from "./AppearanceSettingsPanel.js";
import styles from "./SettingsDialog.module.css";

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
  const extensionSection = sections.find(
    (section) => section.id === activeSectionId,
  );
  const ExtensionSection = extensionSection?.component;
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onDismiss();
      }}
      title="设置"
      size="xl"
      footer={
        <Button variant="secondary" onClick={onDismiss}>
          完成
        </Button>
      }
    >
      <div className={styles.layout}>
        <nav aria-label="设置分类" className={styles.sidebar}>
          <button
            type="button"
            className={styles.navItem}
            data-active={activeSectionId === "models"}
            onClick={() => setActiveSectionId("models")}
          >
            模型
          </button>
          {configuration !== undefined ? (
            <button
              type="button"
              className={styles.navItem}
              data-active={activeSectionId === "agents"}
              onClick={() => setActiveSectionId("agents")}
            >
              Agent
            </button>
          ) : null}
          {configuration !== undefined ? (
            <button
              type="button"
              className={styles.navItem}
              data-active={activeSectionId === "skills"}
              onClick={() => setActiveSectionId("skills")}
            >
              技能
            </button>
          ) : null}
          {configuration !== undefined ? (
            <button
              type="button"
              className={styles.navItem}
              data-active={activeSectionId === "mcp"}
              onClick={() => setActiveSectionId("mcp")}
            >
              MCP 服务器
            </button>
          ) : null}
          <button
            type="button"
            className={styles.navItem}
            data-active={activeSectionId === "appearance"}
            onClick={() => setActiveSectionId("appearance")}
          >
            外观
          </button>
          {sections.map((section) => (
            <button
              type="button"
              key={section.id}
              className={styles.navItem}
              data-active={activeSectionId === section.id}
              onClick={() => setActiveSectionId(section.id)}
            >
              {section.title}
            </button>
          ))}
        </nav>
        <div className={styles.content}>
          {activeSectionId === "models" ? (
            <ModelProviderSettingsPanel
              store={store}
              configuration={configuration}
            />
          ) : null}
          {activeSectionId === "agents" && configuration !== undefined ? (
            <AgentSettingsPanel configuration={configuration} />
          ) : null}
          {activeSectionId === "skills" && configuration !== undefined ? (
            <SkillsSettingsPanel configuration={configuration} />
          ) : null}
          {activeSectionId === "mcp" && configuration !== undefined ? (
            <McpSettingsPanel configuration={configuration} />
          ) : null}
          {activeSectionId === "appearance" ? <AppearanceSettingsPanel /> : null}
          {extensionSection !== undefined && ExtensionSection !== undefined ? (
            <section className={styles.extensionSection}>
              <h3 className={styles.extensionTitle}>{extensionSection.title}</h3>
              <ExtensionSection />
            </section>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
