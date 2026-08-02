/** Store-connected Inspector chrome with safe lifecycle and renderer dispatch. */
import { createElement } from "react";
import {
  useInspectorSnapshot,
  useInspectorStore,
} from "./InspectorStoreContext.js";
import {
  emptyInspectorRendererRegistry,
  type InspectorRendererRegistry,
} from "./InspectorRendererRegistry.js";
import type { InspectorContentSnapshot } from "./InspectorStore.js";

export interface InspectorPanelProps {
  readonly registry?: InspectorRendererRegistry;
}

export function InspectorPanel({
  registry = emptyInspectorRendererRegistry,
}: InspectorPanelProps) {
  const store = useInspectorStore();
  const snapshot = useInspectorSnapshot();
  const target = snapshot.target;
  if (snapshot.mode === "closed" || target === undefined) return null;
  const Renderer = registry.resolve(target.kind);
  return (
    <section className="novel-inspector-panel" data-content-state={snapshot.content.status}>
      <header className="novel-inspector-header">
        <div className="novel-inspector-heading">
          <span>{target.kind}</span>
          <h2>{target.title}</h2>
        </div>
        <div className="novel-inspector-actions">
          <button
            type="button"
            disabled={!snapshot.canGoBack}
            onClick={() => store.back()}
          >
            返回
          </button>
          <button
            type="button"
            onClick={() => store.setMode(snapshot.mode === "expanded" ? "normal" : "expanded")}
          >
            {snapshot.mode === "expanded" ? "标准宽度" : "展开审阅"}
          </button>
          <button type="button" onClick={() => store.close()}>
            关闭
          </button>
        </div>
      </header>
      <InspectorLifecycleStatus status={snapshot.content} />
      <div className="novel-inspector-content">
        {Renderer === undefined ? (
          <p className="novel-inspector-empty">当前内容尚未注册查看器。</p>
        ) : (
          createElement(Renderer, { target, content: snapshot.content })
        )}
      </div>
    </section>
  );
}

function InspectorLifecycleStatus({
  status,
}: {
  readonly status: InspectorContentSnapshot;
}) {
  if (status.status === "idle" || status.status === "loaded") return null;
  const message =
    status.status === "loading"
      ? "正在载入内容"
      : status.status === "stale"
        ? "内容可能已更新，正在等待刷新"
        : status.status === "error"
          ? `内容载入失败（${status.code}）`
          : `当前内容不可用（${status.code}）`;
  return (
    <p className="novel-inspector-status" data-status={status.status} role="status">
      {message}
    </p>
  );
}
