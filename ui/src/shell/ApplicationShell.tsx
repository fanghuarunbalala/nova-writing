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
  type ProjectNavigationItem,
} from "./ProjectSidebar.js";
import { TopMenu } from "./TopMenu.js";
import type { SidebarMode } from "../state/index.js";

export interface ApplicationShellProps {
  readonly context?: CurrentContextBarProps;
  readonly conversations?: readonly ConversationSidebarItem[];
  readonly onNavigate?: (item: ProjectNavigationItem) => void;
  readonly onConversationSelect?: (conversationId: string) => void;
  readonly onOpenWorkspace?: () => void;
  readonly onCloseWorkspace?: () => void;
  readonly onOpenSettings?: () => void;
  readonly workspaceOpen?: boolean;
  readonly sidebarMode?: SidebarMode;
  readonly inspectorMode?: InspectorMode;
  readonly inspector?: ReactNode;
  readonly composer?: ReactNode;
  readonly emptyState?: ReactNode;
  readonly overlays?: ReactNode;
  readonly children?: ReactNode;
}

export function ApplicationShell({
  context,
  conversations,
  onNavigate,
  onConversationSelect,
  onOpenWorkspace,
  onCloseWorkspace,
  onOpenSettings,
  workspaceOpen = false,
  sidebarMode = "expanded",
  inspectorMode = "closed",
  inspector,
  composer,
  emptyState,
  overlays,
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
      <TopMenu
        onCloseWorkspace={onCloseWorkspace}
        onOpenSettings={onOpenSettings}
        onOpenWorkspace={onOpenWorkspace}
        workspaceOpen={workspaceOpen}
      />
      <CurrentContextBar {...context} />
      <div className="novel-shell-body" data-inspector-mode={inspectorMode} data-sidebar-mode={sidebarMode}>
        <ProjectSidebar
          mode={sidebarMode}
          conversations={conversations}
          onNavigate={onNavigate}
          onConversationSelect={onConversationSelect}
        />
        <ConversationWorkspace composer={composer} emptyState={emptyState}>
          {children}
        </ConversationWorkspace>
        <InspectorHost mode={inspectorMode}>{inspector}</InspectorHost>
      </div>
      {overlays}
    </div>
  );
}
