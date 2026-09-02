/**
 * WorkspaceRevisionMeta
 *
 * 修订号 + 最后提交时间的 meta 行。
 */
import styles from "./WorkspaceRevisionMeta.module.css";

export interface WorkspaceRevisionMetaProps {
  readonly revision: string;
  readonly lastCommitAt?: number;
}

function formatCommitTime(timestamp?: number): string {
  if (timestamp === undefined) return "";
  const date = new Date(timestamp);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function WorkspaceRevisionMeta({ revision, lastCommitAt }: WorkspaceRevisionMetaProps) {
  const time = formatCommitTime(lastCommitAt);
  return (
    <span className={styles.meta}>
      <span className={styles.revision}>{revision}</span>
      {time !== "" ? <span className={styles.dot}>·</span> : null}
      {time !== "" ? <span className={styles.time}>最后提交 {time}</span> : null}
    </span>
  );
}
