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

export interface NovelAppProps extends NovelAppProviderProps {
  readonly shell?: Omit<ApplicationShellProps, "children">;
  readonly children?: ReactNode;
}

export function NovelApp(props: NovelAppProps) {
  return (
    <NovelAppProvider {...props}>
      <ApplicationShell {...props.shell}>{props.children}</ApplicationShell>
    </NovelAppProvider>
  );
}
