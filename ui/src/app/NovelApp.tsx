/** Stable shared React application entrypoint used by desktop and Web shells. */
import type { ReactNode } from "react";
import { useMemo } from "react";
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
  readonly children?: ReactNode;
}

export function NovelApp(props: NovelAppProps) {
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
  children,
}: {
  readonly shell?: Omit<ApplicationShellProps, "children">;
  readonly inspectorRenderers?: InspectorRendererRegistry;
  readonly conversationCardProjectors?: ConversationCardProjectorRegistry;
  readonly conversationCardRenderers?: ConversationCardRendererRegistry;
  readonly children?: ReactNode;
}) {
  const snapshot = useApplicationShellSnapshot();
  const shellStore = useApplicationShellStore();
  const inspectorSnapshot = useInspectorSnapshot();
  const inspectorStore = useInspectorStore();
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
  const context = shell?.context ?? {
    workspace: snapshot.workspace?.label,
    meta: snapshot.meta?.label ?? snapshot.novel?.label,
    conversation: snapshot.conversation?.label,
    agent: snapshot.agent?.label,
  };
  const shellProps = {
    ...shell,
    context,
    sidebarMode: shell?.sidebarMode ?? snapshot.sidebarMode,
    inspectorMode: shell?.inspectorMode ?? inspectorSnapshot.mode,
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
