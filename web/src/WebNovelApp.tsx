/**
 * WebNovelApp
 *
 * 浏览器组合根：薄封装共享 NovelApp 入口。
 * 注：Web 侧 workspace 服务（选择/会话）接入后，由宿主注入 WorkspaceController。
 */
import { NovelApp, type NovelAppProps } from "@novel/ui";

export type WebNovelAppProps = NovelAppProps;

export function WebNovelApp(props: WebNovelAppProps) {
  return <NovelApp {...props} />;
}
