/** Stable shared React application entrypoint used by desktop and Web shells. */
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  ApplicationShell,
  type ApplicationShellProps,
} from "../shell/index.js";
import {
  NovelAppProvider,
  type NovelAppProviderProps,
} from "./NovelAppProvider.js";
import {
  ApplicationShellStoreProvider,
  type ApplicationShellState,
  type ApplicationShellStore,
  useApplicationShellStore,
  useApplicationShellSnapshot,
} from "../state/index.js";
import {
  ConversationComposer,
  useConversationProjection,
} from "../conversation/index.js";
import { ConversationProjectionView } from "../conversation/view/index.js";
import {
  emptyInspectorRendererRegistry,
  InspectorPanel,
  type InspectorRendererRegistry,
  InspectorStoreProvider,
  type InspectorStore,
  type InspectorStoreInitialState,
  useInspectorStore,
  useInspectorSnapshot,
} from "../inspector/index.js";
import { ProjectNavigationController } from "../navigation/index.js";
import type {
  ConversationCardDescriptor,
  ConversationCardProjectorRegistry,
  ConversationCardRendererRegistry,
} from "../card/index.js";
import {
  ComposerDraftStoreProvider,
  type ComposerContentReference,
  type ComposerDraftInitialState,
  type ComposerDraftStore,
} from "../composer/index.js";
import {
  ApplicationSettingsStore,
  SettingsDialog,
} from "../settings/index.js";
import { useNovelUiExtensions } from "../extensions/index.js";
import {
  WorkspaceController,
  WorkspaceEmptyState,
  WorkspaceSelectionDialog,
  useWorkspaceControllerSnapshot,
} from "../workspace/index.js";

export interface NovelAppProps extends NovelAppProviderProps {
  readonly shell?: Omit<ApplicationShellProps, "children">;
  readonly shellStore?: ApplicationShellStore;
  readonly initialShellState?: ApplicationShellState;
  readonly inspectorStore?: InspectorStore;
  readonly initialInspectorState?: InspectorStoreInitialState;
  readonly inspectorRenderers?: InspectorRendererRegistry;
  readonly conversationCardProjectors?: ConversationCardProjectorRegistry;
  readonly conversationCardRenderers?: ConversationCardRendererRegistry;
  readonly composerDraftStore?: ComposerDraftStore;
  readonly initialComposerDrafts?: readonly ComposerDraftInitialState[];
  readonly workspaceController?: WorkspaceController;
  readonly settingsStore?: ApplicationSettingsStore;
  readonly children?: ReactNode;
}

export function NovelApp(props: NovelAppProps) {
  const defaultWorkspaceController = useMemo(
    () => new WorkspaceController({ logger: props.logger }),
    [props.logger],
  );
  const defaultSettingsStore = useMemo(
    () =>
      new ApplicationSettingsStore({
        sidebarMode: props.initialShellState?.sidebarMode,
      }),
    [props.initialShellState?.sidebarMode],
  );
  return (
    <NovelAppProvider {...props}>
      <ApplicationShellStoreProvider
        store={props.shellStore}
        initialState={props.initialShellState}
      >
        <ComposerDraftStoreProvider
          store={props.composerDraftStore}
          initialDrafts={props.initialComposerDrafts}
        >
          <InspectorStoreProvider
            store={props.inspectorStore}
            initialState={props.initialInspectorState}
          >
            <ConnectedApplicationShell
              shell={props.shell}
              inspectorRenderers={props.inspectorRenderers}
              conversationCardProjectors={props.conversationCardProjectors}
              conversationCardRenderers={props.conversationCardRenderers}
              settingsStore={props.settingsStore ?? defaultSettingsStore}
              workspaceController={
                props.workspaceController ?? defaultWorkspaceController
              }
            >
              {props.children}
            </ConnectedApplicationShell>
          </InspectorStoreProvider>
        </ComposerDraftStoreProvider>
      </ApplicationShellStoreProvider>
    </NovelAppProvider>
  );
}

function ConnectedApplicationShell({
  shell,
  inspectorRenderers,
  conversationCardProjectors,
  conversationCardRenderers,
  settingsStore,
  workspaceController,
  children,
}: {
  readonly shell?: Omit<ApplicationShellProps, "children">;
  readonly inspectorRenderers?: InspectorRendererRegistry;
  readonly conversationCardProjectors?: ConversationCardProjectorRegistry;
  readonly conversationCardRenderers?: ConversationCardRendererRegistry;
  readonly settingsStore: ApplicationSettingsStore;
  readonly workspaceController: WorkspaceController;
  readonly children?: ReactNode;
}) {
  const snapshot = useApplicationShellSnapshot();
  const shellStore = useApplicationShellStore();
  const inspectorSnapshot = useInspectorSnapshot();
  const inspectorStore = useInspectorStore();
  const extensions = useNovelUiExtensions();
  const workspaceSnapshot = useWorkspaceControllerSnapshot(workspaceController);
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  useEffect(() => {
    void workspaceController.refresh();
  }, [workspaceController]);
  const projectNavigation = useMemo(
    () => new ProjectNavigationController({ shellStore, inspectorStore }),
    [inspectorStore, shellStore],
  );
  const openCardInspector = (card: ConversationCardDescriptor): void => {
    if (card.inspectorTarget === undefined) return;
    inspectorStore.open(card.inspectorTarget, {
      ...(card.inspectorSize !== undefined ? { mode: card.inspectorSize } : {}),
    });
  };
  const openComposerReference = (reference: ComposerContentReference): void => {
    inspectorStore.open(reference.target);
  };
  const openWorkspaceDialog = (): void => {
    workspaceController.clearError();
    setWorkspaceDialogOpen(true);
  };
  const applyWorkspace = (workspace: { readonly id: string; readonly label: string }): void => {
    shellStore.replaceContext({
      workspace: { id: workspace.id, label: workspace.label },
    });
    setWorkspaceDialogOpen(false);
  };
  const chooseWorkspace = async (): Promise<void> => {
    const workspace = await workspaceController.chooseAndOpen();
    if (workspace !== undefined) applyWorkspace(workspace);
  };
  const openRecentWorkspace = async (workspaceId: string): Promise<void> => {
    const workspace = await workspaceController.openRecent(workspaceId);
    if (workspace !== undefined) applyWorkspace(workspace);
  };
  const closeWorkspace = async (): Promise<void> => {
    if (!(await workspaceController.closeCurrent())) return;
    shellStore.replaceContext({});
    setWorkspaceDialogOpen(false);
  };
  const context = {
    workspace:
      shell?.context?.workspace ??
      workspaceSnapshot.current?.label ??
      snapshot.workspace?.label,
    meta: shell?.context?.meta ?? snapshot.meta?.label ?? snapshot.novel?.label,
    conversation: shell?.context?.conversation ?? snapshot.conversation?.label,
    agent: shell?.context?.agent ?? snapshot.agent?.label,
    onWorkspaceSelect:
      shell?.context?.onWorkspaceSelect ?? openWorkspaceDialog,
  };
  const workspaceOpen =
    workspaceSnapshot.current !== undefined || snapshot.workspace !== undefined;
  const shellProps = {
    ...shell,
    context,
    sidebarMode: shell?.sidebarMode ?? snapshot.sidebarMode,
    inspectorMode: shell?.inspectorMode ?? inspectorSnapshot.mode,
    workspaceOpen,
    onOpenWorkspace: shell?.onOpenWorkspace ?? openWorkspaceDialog,
    onCloseWorkspace:
      shell?.onCloseWorkspace ?? (() => {
        void closeWorkspace();
      }),
    onOpenSettings:
      shell?.onOpenSettings ?? (() => setSettingsDialogOpen(true)),
    onNavigate:
      shell?.onNavigate ?? ((item) => {
        projectNavigation.navigate(item);
      }),
    inspector:
      shell?.inspector ?? (
        <InspectorPanel
          registry={inspectorRenderers ?? emptyInspectorRendererRegistry}
        />
      ),
    emptyState:
      shell?.emptyState ??
      (!workspaceOpen ? (
        <WorkspaceEmptyState onSelectWorkspace={openWorkspaceDialog} />
      ) : undefined),
    overlays: (
      <>
        {shell?.overlays}
        <WorkspaceSelectionDialog
          onChoose={() => {
            void chooseWorkspace();
          }}
          onCloseWorkspace={() => {
            void closeWorkspace();
          }}
          onDismiss={() => {
            workspaceController.clearError();
            setWorkspaceDialogOpen(false);
          }}
          onOpenRecent={(workspaceId) => {
            void openRecentWorkspace(workspaceId);
          }}
          open={workspaceDialogOpen}
          snapshot={workspaceSnapshot}
        />
        <SettingsDialog
          onDismiss={() => setSettingsDialogOpen(false)}
          onSidebarModeChange={(sidebarMode) =>
            shellStore.setSidebarMode(sidebarMode)
          }
          open={settingsDialogOpen}
          sections={extensions.settingsSections}
          store={settingsStore}
        />
      </>
    ),
  };
  if (children !== undefined || snapshot.conversation === undefined) {
    return <ApplicationShell {...shellProps}>{children}</ApplicationShell>;
  }
  return (
    <BoundConversationShell
      shell={shellProps}
      conversationId={snapshot.conversation.id}
      cardProjectors={conversationCardProjectors}
      cardRenderers={conversationCardRenderers}
      onOpenCardInspector={openCardInspector}
      onOpenComposerReference={openComposerReference}
    />
  );
}

function BoundConversationShell({
  shell,
  conversationId,
  cardProjectors,
  cardRenderers,
  onOpenCardInspector,
  onOpenComposerReference,
}: {
  readonly shell: Omit<ApplicationShellProps, "children">;
  readonly conversationId: string;
  readonly cardProjectors?: ConversationCardProjectorRegistry;
  readonly cardRenderers?: ConversationCardRendererRegistry;
  readonly onOpenCardInspector?: (card: ConversationCardDescriptor) => void;
  readonly onOpenComposerReference?: (reference: ComposerContentReference) => void;
}) {
  const result = useConversationProjection(conversationId, { cardProjectors });
  const connected = result.snapshot.controller?.state === "live";
  return (
    <ApplicationShell
      {...shell}
      composer={
        shell.composer ?? (
          <ConversationComposer
            conversationId={conversationId}
            enabled={connected}
            enqueue={result.enqueue}
            onOpenReference={onOpenComposerReference}
          />
        )
      }
    >
      <ConversationProjectionView
        result={result}
        cardRenderers={cardRenderers}
        onOpenCardInspector={onOpenCardInspector}
      />
    </ApplicationShell>
  );
}
