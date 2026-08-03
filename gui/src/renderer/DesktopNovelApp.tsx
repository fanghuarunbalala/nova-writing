/** Desktop Renderer composition that injects dependencies into the shared NovelApp. */
import { NovelApp, type NovelAppProps } from "@novel/ui";

export type DesktopNovelAppProps = NovelAppProps;

export function DesktopNovelApp(props: DesktopNovelAppProps) {
  return (
    <NovelApp
      {...props}
      shell={{ ...props.shell, menuPresentation: "native" }}
    />
  );
}
