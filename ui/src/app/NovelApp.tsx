/** Stable shared React application entrypoint used by desktop and Web shells. */
import type { ReactNode } from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
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
  ConversationCatalogController,
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
  type ApplicationConfigurationClient,
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
import type {
  ApplicationCommand,
  ApplicationCommandSource,
} from "../command/index.js";
import { useNovelApi } from "../client/index.js";

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
  readonly configurationClient?: ApplicationConfigurationClient;
  readonly commandSource?: ApplicationCommandSource;
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
              commandSource={props.commandSource}
              settingsStore={props.settingsStore ?? defaultSettingsStore}
              configurationClient={props.configurationClient}
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
  commandSource,
  settingsStore,
  configurationClient,
  workspaceController,
  children,
}: {
  readonly shell?: Omit<ApplicationShellProps, "children">;
  readonly inspectorRenderers?: InspectorRendererRegistry;
  readonly conversationCardProjectors?: ConversationCardProjectorRegistry;
  readonly conversationCardRenderers?: ConversationCardRendererRegistry;
  readonly commandSource?: ApplicationCommandSource;
  readonly settingsStore: ApplicationSettingsStore;
  readonly configurationClient?: ApplicationConfigurationClient;
  readonly workspaceController: WorkspaceController;
  readonly children?: ReactNode;
}) {
  const snapshot = useApplicationShellSnapshot();
  const shellStore = useApplicationShellStore();
  const inspectorSnapshot = useInspectorSnapshot();
  const inspectorStore = useInspectorStore();
  const { api, logger } = useNovelApi();
  const extensions = useNovelUiExtensions();
  const workspaceSnapshot = useWorkspaceControllerSnapshot(workspaceController);
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const conversationCatalog = useMemo(
    () => new ConversationCatalogController({ api, logger }),
    [api, logger],
  );
  const subscribeConversationCatalog = useCallback(
    (listener: () => void) => conversationCatalog.subscribe(listener),
    [conversationCatalog],
  );
  const getConversationCatalogSnapshot = useCallback(
    () => conversationCatalog.getSnapshot(),
    [conversationCatalog],
  );
  const conversationCatalogSnapshot = useSyncExternalStore(
    subscribeConversationCatalog,
    getConversationCatalogSnapshot,
    getConversationCatalogSnapshot,
  );
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
  const applyConversation = (
    conversation:
      | {
          readonly id: string;
          readonly title: string;
          readonly agentType: string;
          readonly agentLabel: string;
        }
      | undefined,
  ): void => {
    shellStore.setConversation(
      conversation === undefined
        ? undefined
        : { id: conversation.id, label: conversation.title },
    );
    shellStore.setAgent(
      conversation === undefined
        ? undefined
        : { id: conversation.agentType, label: conversation.agentLabel },
    );
  };
  const applyWorkspace = async (workspace: {
    readonly id: string;
    readonly label: string;
  }): Promise<void> => {
    shellStore.replaceContext({
      workspace: { id: workspace.id, label: workspace.label },
    });
    setWorkspaceDialogOpen(false);
    const conversation = await conversationCatalog.openWorkspace(workspace.id);
    if (conversationCatalog.getSnapshot().workspaceId === workspace.id) {
      applyConversation(conversation);
    }
  };
  const chooseWorkspace = async (): Promise<void> => {
    const workspace = await workspaceController.chooseAndOpen();
    if (workspace !== undefined) await applyWorkspace(workspace);
  };
  const openRecentWorkspace = async (workspaceId: string): Promise<void> => {
    const workspace = await workspaceController.openRecent(workspaceId);
    if (workspace !== undefined) await applyWorkspace(workspace);
  };
  const closeWorkspace = async (): Promise<void> => {
    if (!(await workspaceController.closeCurrent())) return;
    conversationCatalog.clearWorkspace();
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
  const sidebarMode = shell?.sidebarMode ?? snapshot.sidebarMode;
  const toggleSidebar = (): void => {
    const nextMode = sidebarMode === "expanded" ? "collapsed" : "expanded";
    settingsStore.setSidebarMode(nextMode);
    shellStore.setSidebarMode(nextMode);
  };
  const commandHandlerRef = useRef<(command: ApplicationCommand) => void>(() => {});
  commandHandlerRef.current = (command) => {
    if (command === "workspace.open") openWorkspaceDialog();
    else if (command === "workspace.close") void closeWorkspace();
    else if (command === "settings.open") setSettingsDialogOpen(true);
  };
  useEffect(() => {
    if (commandSource === undefined) return undefined;
    return commandSource.subscribe((command) => commandHandlerRef.current(command));
  }, [commandSource]);
  const shellProps = {
    ...shell,
    context,
    sidebarMode,
    inspectorMode: shell?.inspectorMode ?? inspectorSnapshot.mode,
    workspaceOpen,
    onOpenWorkspace: shell?.onOpenWorkspace ?? openWorkspaceDialog,
    onCloseWorkspace:
      shell?.onCloseWorkspace ?? (() => {
        void closeWorkspace();
      }),
    onOpenSettings:
      shell?.onOpenSettings ?? (() => setSettingsDialogOpen(true)),
    onToggleSidebar: shell?.onToggleSidebar ?? toggleSidebar,
    onNavigate:
      shell?.onNavigate ?? ((item) => {
        if (item === "new-conversation") {
          void conversationCatalog.createConversation().then(applyConversation);
          return;
        }
        projectNavigation.navigate(item);
      }),
    conversations:
      shell?.conversations ??
      conversationCatalogSnapshot.conversations.map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        active:
          conversation.id ===
          conversationCatalogSnapshot.activeConversationId,
      })),
    onConversationSelect:
      shell?.onConversationSelect ??
      ((conversationId) => {
        applyConversation(
          conversationCatalog.selectConversation(conversationId),
        );
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
      ) : snapshot.conversation === undefined ? (
        <div className="novel-conversation-empty" role="status">
          {conversationCatalogSnapshot.phase === "loading" ||
          conversationCatalogSnapshot.phase === "creating"
            ? "正在准备对话…"
            : conversationCatalogSnapshot.phase === "error"
              ? "暂时无法加载对话，请重试新建对话"
              : "选择或新建一个对话"}
        </div>
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
          open={settingsDialogOpen}
          sections={extensions.settingsSections}
          store={settingsStore}
          configuration={configurationClient}
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
