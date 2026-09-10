/** Bounded first-party extension contracts composed by GUI and Web shells. */
import type { ComponentType } from "react";

export interface NovelUiRoute {
  readonly id: string;
  readonly path: string;
  readonly component: ComponentType;
}

export interface NovelUiPanel {
  readonly id: string;
  readonly component: ComponentType;
}

export interface NovelSettingsSection {
  readonly id: string;
  readonly title: string;
  readonly component: ComponentType;
}

export interface NovelUiCommand {
  readonly id: string;
  readonly label: string;
  execute(): void | Promise<void>;
}

export interface NovelUiExtensions {
  readonly titleBar?: ComponentType;
  readonly routes?: readonly NovelUiRoute[];
  readonly sidebarPanels?: readonly NovelUiPanel[];
  readonly inspectorPanels?: readonly NovelUiPanel[];
  readonly settingsSections?: readonly NovelSettingsSection[];
  readonly commands?: readonly NovelUiCommand[];
}

export const emptyNovelUiExtensions: NovelUiExtensions = Object.freeze({
  routes: Object.freeze([]),
  sidebarPanels: Object.freeze([]),
  inspectorPanels: Object.freeze([]),
  settingsSections: Object.freeze([]),
  commands: Object.freeze([]),
});
