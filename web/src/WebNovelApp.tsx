/** Browser composition that injects Web dependencies into the shared NovelApp. */
import { NovelApp, type NovelAppProps } from "@novel/ui";

export type WebNovelAppProps = NovelAppProps;

export function WebNovelApp(props: WebNovelAppProps) {
  return <NovelApp {...props} />;
}
