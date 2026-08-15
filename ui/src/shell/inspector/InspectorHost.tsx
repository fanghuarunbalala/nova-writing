/**
 * InspectorHost
 *
 * 右侧 inspector（PRD AP-1/2）：恒挂载 + insp-head（kicker + close）+ insp-body。
 *
 * 与对话视图绑定（PRD AP-1）：visible=false（非 chat 视图）时按收起态呈现，
 * 路由状态保留——回到对话视图自动恢复。
 * 恒挂载：closed 时 aside 仍在 DOM（aria-hidden + inert + margin-right 收起），
 * 开合切换 .open class 触发过渡（非条件渲染）。
 * 宽度固定档位（决议 2）：>1280 = 376 / ≤1280 = 340 / ≤1080 右缘覆盖抽屉
 * （InspectorHost.module.css 媒体查询；拖拽调宽已移除）。
 * 审批卡片流无目录抽屉（一次 call 一批一起审，PRD AP-3）。
 */
import { memo, useEffect, useMemo } from "react";
import { X } from "lucide-react";
import { debugLog } from "@novel/core/client";
import { Icon } from "../../shared/primitives/Icon.js";
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

const KICKER_BY_KIND: Record<string, string> = {
  approval: "当前对话 · 一次调用一批",
  conversation: "对话元信息",
};

/** 面板标题（原型 .insp-title，无 tab 切换，模式由入口决定）。 */
const TITLE_BY_KIND: Record<string, string> = {
  approval: "审批",
  conversation: "对话元信息",
};

export interface InspectorHostProps {
  readonly inspectorRouter: InspectorRouter;
  /** 与对话视图绑定（PRD AP-1）：非 chat 视图按收起态呈现，路由状态保留。 */
  readonly visible?: boolean;
  readonly conversationCatalog: ConversationCatalogStore;
  readonly outlineTree: StoryOutlineTreeStore;
  readonly characters: CharacterStore;
  readonly locations: LocationStore;
  readonly approvalStore: ApprovalStore;
  /** 审批目标实体内容解析器（lite：经 api.novel.* 查询 + 乐观锁 stale 判定）。 */
  readonly resolveEntity?: ApprovalEntityResolver;
  readonly onLocateInContent?: (entityId: string) => void;
}

/** 右侧审批/档案面板宿主（memo：流式发布期间跳过，gui-performance-2 功能点五） */
export const InspectorHost = memo(function InspectorHost({
  inspectorRouter,
  visible = true,
  conversationCatalog,
  outlineTree,
  characters,
  locations,
  approvalStore,
  resolveEntity,
  onLocateInContent,
}: InspectorHostProps) {
  const route = useInspectorRoute(inspectorRouter);
  const approvalSnapshot = useExternalStore(approvalStore);
  const activeConversationId = conversationCatalog.getSnapshot().activeConversationId;
  // 待审计数徽标：当前活动会话的待审批数（面板已会话化，不再展示全局计数）
  const pendingCount = useMemo(
    () =>
      approvalSnapshot.approvals.filter(
        (approval) =>
          approval.conversationId === activeConversationId &&
          approval.status === "pending",
      ).length,
    [approvalSnapshot.approvals, activeConversationId],
  );
  // 恒挂载：closed 时 aside 仍在 DOM（aria-hidden + inert + margin-right 收起）。
  const open = route.state.kind !== "closed" && visible;

  // TEMP-DIAG（断字换行排查，verbose 门控）：面板开合时序，与 [timeline-diag] 时间轴对齐
  useEffect(() => {
    debugLog(
      `[inspector-diag] kind=${route.state.kind} open=${open} t=${Math.round(performance.now())}`,
    );
  }, [route.state.kind, open]);

  const kicker = KICKER_BY_KIND[route.state.kind] ?? "详情";
  const title = TITLE_BY_KIND[route.state.kind] ?? "详情";
  return (
    <aside
      className={[styles.host, open ? styles.open : ""].filter(Boolean).join(" ")}
      aria-hidden={!open}
      inert={!open}
    >
      {open ? (
        <>
          <header className={styles.head}>
            <h3 className={styles.inspTitle}>{title}</h3>
            {route.state.kind === "approval" ? (
              <span
                className={[
                  styles.ltCnt,
                  pendingCount === 0 ? styles.ltCntZero : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {pendingCount}
              </span>
            ) : null}
            <span className={styles.kicker}>{kicker}</span>
            <button
              type="button"
              className={styles.close}
              aria-label="收起面板"
              onClick={() => inspectorRouter.close()}
            >
              <Icon icon={X} size="sm" />
            </button>
          </header>
          <div className={styles.body}>
            {route.state.kind === "approval" ? (
              <ApprovalPanel
                store={approvalStore}
                conversationId={activeConversationId}
                resolveEntity={resolveEntity}
              />
            ) : route.state.kind === "conversation" ? (
              <ConversationInspectorPanel
                conversationId={route.state.conversationId}
                conversationCatalog={conversationCatalog}
              />
            ) : (
              <div className={styles.pending}>详情面板待定</div>
            )}
          </div>
        </>
      ) : (
        <div className={styles.body} />
      )}
    </aside>
  );
});
