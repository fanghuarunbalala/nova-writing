/**
 * InspectorHost
 *
 * 右侧 inspector（原型 .inspector）：恒挂载 + 拖拽调宽 + insp-head（kicker + close）
 * + insp-body（按路由渲染 panel）。
 *
 * 恒挂载：closed 时 aside 仍在 DOM（aria-hidden + inert + margin-right 收起），
 * 开合切换 .open class 触发过渡（非条件渲染）。宽度由 --insp-w 决定——
 * 默认取 tokens 860px，响应式收窄由媒体查询覆盖；用户拖拽时写 inline
 * --insp-w（仅拖过才写，未拖交给 CSS）。
 *
 * insp-head（对齐原型）：标题（.insp-title，按面板类型显示「审批/档案/大纲单元/
 * 对话元信息」）+ 审批模式下「目录 N」按钮（点击弹出覆盖抽屉，drawerOpen 状态）+
 * kicker + close。面板内审批目录始终为左侧滑出覆盖抽屉（无常驻列），
 * 选中条目自动收起。close 触发 inspectorRouter.close()。
 */
import {
  useCallback,
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
import type { ApprovalEntityResolver } from "../../domains/approval/approvalEntityResolver.js";
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

/** 面板标题（原型 .insp-title，无 tab 切换，模式由入口决定）。 */
const TITLE_BY_KIND: Record<string, string> = {
  approval: "审批",
  entity: "档案",
  outlineUnit: "大纲单元",
  conversation: "对话元信息",
};

export interface InspectorHostProps {
  readonly inspectorRouter: InspectorRouter;
  readonly conversationCatalog: ConversationCatalogStore;
  readonly outlineTree: StoryOutlineTreeStore;
  readonly characters: CharacterStore;
  readonly locations: LocationStore;
  readonly approvalStore: ApprovalStore;
  /** 删除/编辑目标实体内容解析器（转发给审批面板）。Entity resolver. */
  readonly approvalEntityResolver?: ApprovalEntityResolver;
  /** 当前 canonical 修订号（转发给审批面板判失效）。Current revision. */
  readonly sourceRevision?: string;
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
  approvalEntityResolver,
  sourceRevision,
  onLocateInContent,
  onJumpToConversation,
}: InspectorHostProps) {
  const route = useInspectorRoute(inspectorRouter);
  const [draggedW, setDraggedW] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const widthRef = useRef<number | null>(null);
  const approvalSnapshot = useExternalStore(approvalStore);
  // 恒挂载：closed 时 aside 仍在 DOM（aria-hidden + inert + margin-right 收起）。
  const open = route.state.kind !== "closed";

  // 拖拽调宽（对齐原型 JS）：≤860 不拖；minW 560/340、maxW min(1120, vw-520)。
  const handleResize = useCallback((delta: number) => {
    const vw = window.innerWidth;
    if (vw <= 860) return;
    const minW = vw > 860 && vw <= 1200 ? 340 : 560;
    const maxW = Math.min(1120, vw - 520);
    // 右侧面板左缘把手:向左拖变宽、向右拖变窄(原型 startW + (startX - clientX) = -delta)。
    const next = Math.min(
      maxW,
      Math.max(minW, (widthRef.current ?? DEFAULT_WIDTH) - delta),
    );
    widthRef.current = next;
    setDraggedW(next);
  }, []);

  const workspaceId =
    conversationCatalog.getSnapshot().workspaceId ??
    outlineTree.getSnapshot().workspaceId;
  const kicker = KICKER_BY_KIND[route.state.kind] ?? "详情";
  const title = TITLE_BY_KIND[route.state.kind] ?? "详情";
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
            <h3 className={styles.inspTitle}>{title}</h3>
            {route.state.kind === "approval" ? (
              <button
                type="button"
                className={styles.listToggle}
                onClick={() => setDrawerOpen((value) => !value)}
                aria-expanded={drawerOpen}
                aria-controls="approval-directory"
              >
                目录
                {approvalSnapshot.pendingCount > 0 ? (
                  <span className={styles.ltCnt}>{approvalSnapshot.pendingCount}</span>
                ) : null}
              </button>
            ) : null}
            <span className={styles.kicker}>{kicker}</span>
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
            {route.state.kind === "approval" ? (
              <ApprovalPanel
                store={approvalStore}
                resolveEntity={approvalEntityResolver}
                sourceRevision={sourceRevision}
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
