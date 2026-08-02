/** Shared chat-first application layout used by GUI and Web. */
import type { ReactNode } from "react";
import { useNovelUiExtensions } from "../extensions/index.js";
import { NovelThemeStyles } from "../theme/index.js";
import { ConversationWorkspace } from "./ConversationWorkspace.js";
import {
  CurrentContextBar,
  type CurrentContextBarProps,
} from "./CurrentContextBar.js";
import { InspectorHost, type InspectorMode } from "./InspectorHost.js";
import {
  ProjectSidebar,
  type ConversationSidebarItem,
} from "./ProjectSidebar.js";
import { TopMenu } from "./TopMenu.js";
import type { SidebarMode } from "../state/index.js";

export interface ApplicationShellProps {
  readonly context?: CurrentContextBarProps;
  readonly conversations?: readonly ConversationSidebarItem[];
  readonly sidebarMode?: SidebarMode;
  readonly inspectorMode?: InspectorMode;
  readonly inspector?: ReactNode;
  readonly composer?: ReactNode;
  readonly children?: ReactNode;
}

export function ApplicationShell({
  context,
  conversations,
  sidebarMode = "expanded",
  inspectorMode = "closed",
  inspector,
  composer,
  children,
}: ApplicationShellProps) {
  const extensions = useNovelUiExtensions();
  const TitleBar = extensions.titleBar;
  return (
    <div className="novel-app-shell">
      <NovelThemeStyles />
      <div className="novel-titlebar-extension">
        {TitleBar !== undefined ? <TitleBar /> : null}
      </div>
      <TopMenu />
      <CurrentContextBar {...context} />
      <div className="novel-shell-body" data-inspector-mode={inspectorMode} data-sidebar-mode={sidebarMode}>
        <ProjectSidebar mode={sidebarMode} conversations={conversations} />
        <ConversationWorkspace composer={composer}>{children}</ConversationWorkspace>
        <InspectorHost mode={inspectorMode}>{inspector}</InspectorHost>
      </div>
    </div>
  );
}
