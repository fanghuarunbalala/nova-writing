/** Stable timestamp presentation without locale-dependent server rendering. */
export function TimelineTimestamp({ timestamp }: { readonly timestamp: string }) {
  const label = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u.test(timestamp)
    ? timestamp.slice(11, 16)
    : timestamp;
  return <time dateTime={timestamp}>{label}</time>;
}
