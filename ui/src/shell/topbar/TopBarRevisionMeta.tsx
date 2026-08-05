/**
 * TopBarRevisionMeta
 *
 * 顶栏修订信息（数据源依赖 core workspace metadata API，未就绪时为 null）。
 */
export interface TopBarRevisionMetaProps {
  readonly revision?: string;
  readonly lastCommitAt?: number;
}

export function TopBarRevisionMeta({ revision, lastCommitAt }: TopBarRevisionMetaProps) {
  if (revision === undefined) return null;
  return (
    <span className="kicker">
      {revision}
      {lastCommitAt !== undefined ? ` · ${new Date(lastCommitAt).toLocaleTimeString()}` : ""}
    </span>
  );
}
