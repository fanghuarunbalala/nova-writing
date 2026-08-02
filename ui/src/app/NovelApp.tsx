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

export interface NovelAppProps extends NovelAppProviderProps {
  readonly shell?: Omit<ApplicationShellProps, "children">;
  readonly shellStore?: ApplicationShellStore;
  readonly initialShellState?: ApplicationShellState;
  readonly inspectorStore?: InspectorStore;
  readonly initialInspectorState?: InspectorStoreInitialState;
  readonly inspectorRenderers?: InspectorRendererRegistry;
  readonly children?: ReactNode;
}

export function NovelApp(props: NovelAppProps) {
  return (
    <NovelAppProvider {...props}>
      <ApplicationShellStoreProvider
        store={props.shellStore}
        initialState={props.initialShellState}
      >
        <InspectorStoreProvider
          store={props.inspectorStore}
          initialState={props.initialInspectorState}
        >
          <ConnectedApplicationShell
            shell={props.shell}
            inspectorRenderers={props.inspectorRenderers}
          >
            {props.children}
          </ConnectedApplicationShell>
        </InspectorStoreProvider>
      </ApplicationShellStoreProvider>
    </NovelAppProvider>
  );
}

function ConnectedApplicationShell({
  shell,
  inspectorRenderers,
  children,
}: {
  readonly shell?: Omit<ApplicationShellProps, "children">;
  readonly inspectorRenderers?: InspectorRendererRegistry;
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
    />
  );
}

function BoundConversationShell({
  shell,
  conversationId,
}: {
  readonly shell: Omit<ApplicationShellProps, "children">;
  readonly conversationId: string;
}) {
  const result = useConversationProjection(conversationId);
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
          />
        )
      }
    >
      <ConversationProjectionView result={result} />
    </ApplicationShell>
  );
}
