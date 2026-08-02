/** Stable shared React application entrypoint used by desktop and Web shells. */
import type { ReactNode } from "react";
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
  useApplicationShellSnapshot,
} from "../state/index.js";
import { ConversationView } from "../conversation/view/index.js";

export interface NovelAppProps extends NovelAppProviderProps {
  readonly shell?: Omit<ApplicationShellProps, "children">;
  readonly shellStore?: ApplicationShellStore;
  readonly initialShellState?: ApplicationShellState;
  readonly children?: ReactNode;
}

export function NovelApp(props: NovelAppProps) {
  return (
    <NovelAppProvider {...props}>
      <ApplicationShellStoreProvider
        store={props.shellStore}
        initialState={props.initialShellState}
      >
        <ConnectedApplicationShell shell={props.shell}>
          {props.children}
        </ConnectedApplicationShell>
      </ApplicationShellStoreProvider>
    </NovelAppProvider>
  );
}

function ConnectedApplicationShell({
  shell,
  children,
}: {
  readonly shell?: Omit<ApplicationShellProps, "children">;
  readonly children?: ReactNode;
}) {
  const snapshot = useApplicationShellSnapshot();
  const context = shell?.context ?? {
    workspace: snapshot.workspace?.label,
    meta: snapshot.meta?.label ?? snapshot.novel?.label,
    conversation: snapshot.conversation?.label,
    agent: snapshot.agent?.label,
  };
  return (
    <ApplicationShell
      {...shell}
      context={context}
      sidebarMode={shell?.sidebarMode ?? snapshot.sidebarMode}
    >
      {children ??
        (snapshot.conversation !== undefined ? (
          <ConversationView conversationId={snapshot.conversation.id} />
        ) : undefined)}
    </ApplicationShell>
  );
}
