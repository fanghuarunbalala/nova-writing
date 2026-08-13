/**
 * TopBarRevisionMeta
 *
 * 顶栏修订信息（数据源依赖 core workspace metadata API，未就绪时为 null）。
 * 视觉对齐原型 .rev-meta：mono 字体 + faint 灰，无 letter-spacing/uppercase
 * （区别于 .kicker，后者用于 section label 等 uppercase 场景）。
 */
import styles from "./TopBarRevisionMeta.module.css";

export interface TopBarRevisionMetaProps {
  readonly revision?: string;
  readonly lastCommitAt?: number;
}

export function TopBarRevisionMeta({ revision, lastCommitAt }: TopBarRevisionMetaProps) {
  if (revision === undefined) return null;
  return (
    <span className={styles.revMeta}>
      {revision}
      {lastCommitAt !== undefined ? ` · ${new Date(lastCommitAt).toLocaleTimeString()}` : ""}
    </span>
  );
}
