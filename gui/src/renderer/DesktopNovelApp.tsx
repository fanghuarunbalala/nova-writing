/**
 * DesktopNovelApp
 *
 * 桌面组合根：薄封装共享 NovelApp 入口（组合逻辑在 @novel/ui app/NovelApp）。
 */
import { NovelApp, type NovelAppProps } from "@novel/ui";

export type DesktopNovelAppProps = NovelAppProps;

export function DesktopNovelApp(props: DesktopNovelAppProps) {
  return <NovelApp {...props} />;
}
