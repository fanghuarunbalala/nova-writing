/**
 * InspectorHost
 *
 * 右侧 inspector：按路由渲染 panel，拖拽调宽（范围来自 tokens）。
 */
import { useState } from "react";
import { DragHandle } from "../../shared/primitives/DragHandle.js";
import { useInspectorRoute } from "../../shared/routing/hooks.js";
import type { InspectorRouter } from "../../shared/routing/InspectorRouter.js";
import type { ConversationCatalogStore } from "../../domains/conversation/store/ConversationCatalogStore.js";
import type { CharacterStore } from "../../domains/novel/character/store/CharacterStore.js";
import type { LocationStore } from "../../domains/novel/location/store/LocationStore.js";
import type { StoryOutlineTreeStore } from "../../domains/novel/outline/store/StoryOutlineTreeStore.js";
import { ConversationInspectorPanel } from "./panels/ConversationInspectorPanel.js";
import { EntityInspectorPanel } from "./panels/EntityInspectorPanel.js";
import { OutlineUnitInspectorPanel } from "./panels/OutlineUnitInspectorPanel.js";
import styles from "./InspectorHost.module.css";

const DEFAULT_WIDTH = 384;
const MIN_WIDTH = 300;
const MAX_WIDTH = 680;

export interface InspectorHostProps {
  readonly inspectorRouter: InspectorRouter;
  readonly conversationCatalog: ConversationCatalogStore;
  readonly outlineTree: StoryOutlineTreeStore;
  readonly characters: CharacterStore;
  readonly locations: LocationStore;
  readonly onLocateInContent?: (entityId: string) => void;
}

export function InspectorHost({
  inspectorRouter,
  conversationCatalog,
  outlineTree,
  characters,
  locations,
  onLocateInContent,
}: InspectorHostProps) {
  const route = useInspectorRoute(inspectorRouter);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  if (route.state.kind === "closed") return null;
  const workspaceId =
    conversationCatalog.getSnapshot().workspaceId ??
    outlineTree.getSnapshot().workspaceId;
  return (
    <aside className={styles.host} style={{ width }}>
      <DragHandle
        orientation="horizontal"
        ariaLabel="调整面板宽度"
        onResize={(delta) =>
          setWidth((current) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, current + delta)))
        }
      />
      <div className={styles.body}>
        {route.state.kind === "entity" ? (
          <EntityInspectorPanel
            workspaceId={workspaceId}
            entityType={route.state.entityType}
            entityId={route.state.entityId}
            characters={characters}
            locations={locations}
            onLocateInContent={onLocateInContent}
          />
        ) : route.state.kind === "outlineUnit" ? (
          <OutlineUnitInspectorPanel
            workspaceId={workspaceId}
            unitId={route.state.unitId}
            outlineTree={outlineTree}
          />
        ) : route.state.kind === "conversation" ? (
          <ConversationInspectorPanel
            conversationId={route.state.conversationId}
            conversationCatalog={conversationCatalog}
          />
        ) : (
          <div className={styles.pending}>审批面板待定（approval 域延后）</div>
        )}
      </div>
    </aside>
  );
}
