/** Stable shared React application entrypoint used by desktop and Web shells. */
import type { ReactNode } from "react";
import {
  NovelAppProvider,
  type NovelAppProviderProps,
} from "./NovelAppProvider.js";

export interface NovelAppProps extends NovelAppProviderProps {
  readonly children?: ReactNode;
}

export function NovelApp(props: NovelAppProps) {
  return <NovelAppProvider {...props}>{props.children}</NovelAppProvider>;
}
