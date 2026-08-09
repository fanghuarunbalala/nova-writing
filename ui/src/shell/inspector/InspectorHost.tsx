/**
 * InspectorHost
 *
 * 右侧 inspector（原型 .inspector）：恒挂载 + 拖拽调宽 + insp-head（kicker + close）
 * + insp-body（按路由渲染 panel）。
 *
 * 恒挂载：closed 时 aside 仍在 DOM（aria-hidden + inert + margin-right 收起），
 * 开合切换 .open class 触发过渡（非条件渲染）。宽度由 --insp-w 决定——
 * 默认取 tokens 860px，响应式收窄由媒体查询覆盖；用户拖拽时写 inline
 * --insp-w（仅拖过才写，未拖交给 CSS）。面板内审批目录在窄宽度下
 * （@container ≤600px）折叠为左侧滑出抽屉（drawerOpen 状态）。
 *
 * insp-head 的 kicker 按 panel 类型动态显示标签；close 触发 inspectorRouter.close()。
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { DragHandle } from "../../shared/primitives/DragHandle.js";
import { useInspectorRoute } from "../../shared/routing/hooks.js";
import type { InspectorRouter } from "../../shared/routing/InspectorRouter.js";
import type { ConversationCatalogStore } from "../../domains/conversation/store/ConversationCatalogStore.js";
import type { CharacterStore } from "../../domains/novel/character/store/CharacterStore.js";
import type { LocationStore } from "../../domains/novel/location/store/LocationStore.js";
import type { StoryOutlineTreeStore } from "../../domains/novel/outline/store/StoryOutlineTreeStore.js";
import type { ApprovalStore } from "../../domains/approval/ApprovalStore.js";
import { useExternalStore } from "../../shared/state/useExternalStore.js";
import { ApprovalPanel } from "../../domains/approval/components/ApprovalPanel.js";
import { ConversationInspectorPanel } from "./panels/ConversationInspectorPanel.js";
import { EntityInspectorPanel } from "./panels/EntityInspectorPanel.js";
import { OutlineUnitInspectorPanel } from "./panels/OutlineUnitInspectorPanel.js";
import styles from "./InspectorHost.module.css";

/** 未拖拽时的默认宽度（与 tokens --insp-w 一致）。 */
const DEFAULT_WIDTH = 860;

const KICKER_BY_KIND: Record<string, string> = {
  entity: "档案 · 角色 / 地点",
  outlineUnit: "大纲单元",
  conversation: "对话元信息",
  approval: "审批参数 · 变更集不可变，批准执行后才产出差异",
};

export interface InspectorHostProps {
  readonly inspectorRouter: InspectorRouter;
  readonly conversationCatalog: ConversationCatalogStore;
  readonly outlineTree: StoryOutlineTreeStore;
  readonly characters: CharacterStore;
  readonly locations: LocationStore;
  readonly approvalStore: ApprovalStore;
  readonly onLocateInContent?: (entityId: string) => void;
  /** 审批目录「跳转」：切换主视图到对应对话（应用层负责 select + transition）。 */
  readonly onJumpToConversation?: (conversationId: string) => void;
}

export function InspectorHost({
  inspectorRouter,
  conversationCatalog,
  outlineTree,
  characters,
  locations,
  approvalStore,
  onLocateInContent,
  onJumpToConversation,
}: InspectorHostProps) {
  const route = useInspectorRoute(inspectorRouter);
  const [tab, setTab] = useState<"approval" | "detail">("approval");
  const [draggedW, setDraggedW] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const widthRef = useRef<number | null>(null);
  const approvalSnapshot = useExternalStore(approvalStore);
  // 恒挂载：closed 时 aside 仍在 DOM（aria-hidden + inert + margin-right 收起）。
  const open = route.state.kind !== "closed";
  useEffect(() => {
    console.info("[inspector] host route changed", {
      kind: route.state.kind,
      tab,
    });
    if (
      route.state.kind === "entity" ||
      route.state.kind === "outlineUnit" ||
      route.state.kind === "conversation"
    ) {
      setTab("detail");
    } else if (route.state.kind === "approval") {
      setTab("approval");
    }
  }, [route.state.kind, tab]);

  // 拖拽调宽（对齐原型 JS）：≤860 不拖；minW 560/340、maxW min(1120, vw-520)。
  const handleResize = useCallback((delta: number) => {
    const vw = window.innerWidth;
    if (vw <= 860) return;
    const minW = vw > 860 && vw <= 1200 ? 340 : 560;
    const maxW = Math.min(1120, vw - 520);
    const next = Math.min(
      maxW,
      Math.max(minW, (widthRef.current ?? DEFAULT_WIDTH) + delta),
    );
    widthRef.current = next;
    setDraggedW(next);
  }, []);

  const workspaceId =
    conversationCatalog.getSnapshot().workspaceId ??
    outlineTree.getSnapshot().workspaceId;
  const kicker = KICKER_BY_KIND[route.state.kind] ?? "详情";
  return (
    <aside
      className={[styles.host, open ? styles.open : ""].filter(Boolean).join(" ")}
      aria-hidden={!open}
      inert={!open}
      style={
        draggedW !== null
          ? ({ "--insp-w": `${draggedW}px` } as CSSProperties)
          : undefined
      }
    >
      <div className={styles.drag}>
        <DragHandle
          orientation="horizontal"
          ariaLabel="调整面板宽度"
          onResize={handleResize}
        />
      </div>
      {open ? (
        <>
          <header className={styles.head}>
            <div className={styles.tabs} role="tablist" aria-label="右侧面板">
              <button
                type="button"
                className={[styles.tab, tab === "approval" ? styles.tabActive : ""].filter(Boolean).join(" ")}
                onClick={() => setTab("approval")}
                aria-selected={tab === "approval"}
                role="tab"
              >
                审批
                {approvalSnapshot.pendingCount > 0 ? (
                  <span className={styles.countPill}>{approvalSnapshot.pendingCount} 待审</span>
                ) : null}
              </button>
              {route.state.kind !== "approval" ? (
                <button
                  type="button"
                  className={[styles.tab, tab === "detail" ? styles.tabActive : ""].filter(Boolean).join(" ")}
                  onClick={() => setTab("detail")}
                  aria-selected={tab === "detail"}
                  role="tab"
                >
                  档案
                </button>
              ) : null}
            </div>
            <span className={styles.kicker}>
              {tab === "approval" ? KICKER_BY_KIND.approval : kicker}
            </span>
            <button
              type="button"
              className={styles.close}
              aria-label="收起面板"
              onClick={() => inspectorRouter.close()}
            >
              ✕
            </button>
          </header>
          <div className={styles.body}>
            {tab === "approval" ? (
              <ApprovalPanel
                store={approvalStore}
                conversationLabels={new Map(
                  conversationCatalog
                    .getSnapshot()
                    .conversations.map((conversation) => [
                      conversation.id,
                      conversation.title ?? conversation.id,
                    ]),
                )}
                onJumpToConversation={onJumpToConversation}
                drawerOpen={drawerOpen}
                onToggleDrawer={setDrawerOpen}
              />
            ) : route.state.kind === "entity" ? (
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
        </>
      ) : (
        <div className={styles.body} />
      )}
    </aside>
  );
}
