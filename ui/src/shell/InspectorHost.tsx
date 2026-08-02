/** Right-side contextual Inspector presentation with review expansion modes. */
import type { ReactNode } from "react";

export type InspectorMode = "closed" | "normal" | "expanded";

export interface InspectorHostProps {
  readonly mode?: InspectorMode;
  readonly children?: ReactNode;
}

export function InspectorHost({
  mode = "closed",
  children,
}: InspectorHostProps) {
  return (
    <aside
      className="novel-inspector-host"
      data-inspector-mode={mode}
      aria-label="内容检查器"
      aria-hidden={mode === "closed"}
    >
      {children}
    </aside>
  );
}
