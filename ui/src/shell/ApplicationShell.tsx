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
  type ProjectNavigationDetail,
  type ProjectNavigationItem,
} from "./ProjectSidebar.js";
import { TopMenu } from "./TopMenu.js";
import type { SidebarMode } from "../state/index.js";

export interface ApplicationShellProps {
  readonly context?: CurrentContextBarProps;
  readonly conversations?: readonly ConversationSidebarItem[];
  readonly navigationDetails?: Partial<
    Readonly<Record<ProjectNavigationItem, ProjectNavigationDetail>>
  >;
  readonly onNavigate?: (item: ProjectNavigationItem) => void;
  readonly onConversationSelect?: (conversationId: string) => void;
  readonly onOpenWorkspace?: () => void;
  readonly onCloseWorkspace?: () => void;
  readonly onOpenSettings?: () => void;
  readonly onToggleSidebar?: () => void;
  readonly workspaceOpen?: boolean;
  readonly sidebarMode?: SidebarMode;
  readonly menuPresentation?: "inline" | "native";
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
  navigationDetails,
  onNavigate,
  onConversationSelect,
  onOpenWorkspace,
  onCloseWorkspace,
  onOpenSettings,
  onToggleSidebar,
  workspaceOpen = false,
  sidebarMode = "expanded",
  menuPresentation = "inline",
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
    <div className="novel-app-shell" data-menu-presentation={menuPresentation}>
      <NovelThemeStyles />
      <div className="novel-titlebar-extension">
        {TitleBar !== undefined ? <TitleBar /> : null}
      </div>
      {menuPresentation === "inline" ? (
        <TopMenu
          onCloseWorkspace={onCloseWorkspace}
          onOpenSettings={onOpenSettings}
          onOpenWorkspace={onOpenWorkspace}
          onToggleSidebar={onToggleSidebar}
          sidebarMode={sidebarMode}
          workspaceOpen={workspaceOpen}
        />
      ) : null}
      <CurrentContextBar
        {...context}
        {...(menuPresentation === "native"
          ? { sidebarMode, onToggleSidebar }
          : {})}
      />
      <div className="novel-shell-body" data-inspector-mode={inspectorMode} data-sidebar-mode={sidebarMode}>
        <ProjectSidebar
          mode={sidebarMode}
          conversations={conversations}
          navigationDetails={navigationDetails}
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
