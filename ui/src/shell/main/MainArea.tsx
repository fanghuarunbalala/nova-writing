/**
 * MainArea
 *
 * 主区路由 host：按 MainViewRouter 状态渲染 chat/content/schedule。
 * 精简版：去掉审批相关 props（延后）。
 */
import { memo } from "react";
import { useMainView } from "../../shared/routing/hooks.js";
import type { MainViewRouter } from "../../shared/routing/MainViewRouter.js";
import type { ToastKind } from "../../shared/state/ToastStore.js";
import type { Logger, NovelApiClient } from "@novel/core";
import type { ConversationCatalogStore } from "../../domains/conversation/store/ConversationCatalogStore.js";
import type { CharacterStore } from "../../domains/novel/character/store/CharacterStore.js";
import type { LocationStore } from "../../domains/novel/location/store/LocationStore.js";
import type { ManuscriptStructureStore } from "../../domains/novel/manuscript/store/ManuscriptStructureStore.js";
import type { StoryOutlineTreeStore } from "../../domains/novel/outline/store/StoryOutlineTreeStore.js";
import type { ScheduleStore } from "../../domains/schedule/store/ScheduleStore.js";
import type { ScheduleTodoStore } from "../../domains/schedule/store/ScheduleTodoStore.js";
import type { ConversationProjectionBinding } from "../../domains/conversation/binding/ConversationProjectionBinding.js";
import { ChatSurface } from "./ChatSurface.js";
import { ContentSurface } from "./ContentSurface.js";
import type { ContentTab } from "./contentTab.js";
import type { ReferenceResolver } from "../../domains/conversation/reference/ReferenceResolver.js";
import type { MessageReference } from "../../domains/conversation/components/MessageReference.js";
import type { ApprovalStore } from "../../domains/approval/ApprovalStore.js";
import { ScheduleSurface } from "./ScheduleSurface.js";
import styles from "./MainArea.module.css";

export interface MainAreaProps {
  readonly api: NovelApiClient;
  readonly logger?: Logger;
  /** 活动会话投影 binding（shell 持有；快照订阅在 ChatSurface 内——流式发布不重渲染本组件） */
  readonly conversationBinding: ConversationProjectionBinding | undefined;
  readonly pendingApprovalCount?: number;
  /** 审批弹窗开合（挂起提示条显隐：弹窗开着时提示条让位） */
  readonly approvalModalOpen?: boolean;
  /** 唤起审批弹窗（挂起提示条 / 状态行 / 工具行 / 时间线系统行入口） */
  readonly onSummonApproval?: (requestId?: string) => void;
  /** 右栏内容目录开合（对话顶条开关按钮点亮态） */
  readonly directoryOpen?: boolean;
  /** 对话顶条「内容目录」开关（directory ↔ closed） */
  readonly onToggleDirectory?: () => void;
  readonly mainViewRouter: MainViewRouter;
  readonly conversationCatalog: ConversationCatalogStore;
  readonly outlineTree: StoryOutlineTreeStore;
  readonly manuscript: ManuscriptStructureStore;
  readonly characters: CharacterStore;
  readonly locations: LocationStore;
  readonly schedule: ScheduleStore;
  readonly scheduleTodo: ScheduleTodoStore;
  readonly contentTab: ContentTab;
  /** 档案选区（壳持有；内容视图详情渲染） */
  readonly selectedCharacterId?: string;
  readonly selectedLocationId?: string;
  /** 计划视图选中待办（null = 总览） */
  readonly planTodoId: string | null;
  readonly onSelectPlanTodo: (id: string | null) => void;
  readonly onCreateConversation: () => void;
  /** 打开会话信息面板（inspector conversation 路由；PRD 决议 1） */
  readonly onOpenConversationInfo?: (conversationId: string) => void;
  readonly onTodoAction?: (id: string, action: string) => void;
  readonly onReferenceClick?: (reference: MessageReference) => void;
  readonly resolveReference?: ReferenceResolver;
  readonly locateReference?: { readonly kind: "chapter" | "paragraph"; readonly id: string; readonly nonce: number } | null;
  readonly onNotify?: (kind: ToastKind, text: string) => void;
  /** 内容视图：切资料位（详情面板「在正文中查看」） */
  readonly onSelectContentPane?: (pane: ContentTab) => void;
  /** 内容视图：跳人物/地点档案（leaf chips） */
  readonly onOpenCharacter?: (characterId: string) => void;
  readonly onOpenLocation?: (locationId: string) => void;
  readonly approvalStore: ApprovalStore;
}

/** 主区路由 host（memo：流式发布期间 props 全稳定，跳过 reconciliation） */
export const MainArea = memo(function MainArea(props: MainAreaProps) {
  const mainView = useMainView(props.mainViewRouter);
  const workspaceId =
    props.conversationCatalog.getSnapshot().workspaceId ??
    props.outlineTree.getSnapshot().workspaceId;
  return (
    <main className={styles.main}>
      {mainView.state === "chat" ? (
        <ChatSurface
          conversationBinding={props.conversationBinding}
          conversationCatalog={props.conversationCatalog}
          onCreateConversation={props.onCreateConversation}
          pendingApprovalCount={props.pendingApprovalCount ?? 0}
          approvalModalOpen={props.approvalModalOpen ?? false}
          onSummonApproval={props.onSummonApproval}
          directoryOpen={props.directoryOpen ?? true}
          onToggleDirectory={props.onToggleDirectory}
          onOpenConversationInfo={props.onOpenConversationInfo}
          onReferenceClick={props.onReferenceClick}
          resolveReference={props.resolveReference}
          onNotify={props.onNotify}
        />
      ) : mainView.state === "content" ? (
        // key=contentTab：tab 切换也重挂载触发 view-in 过渡
        <ContentSurface
          key={props.contentTab}
          workspaceId={workspaceId}
          value={props.contentTab}
          outlineTree={props.outlineTree}
          manuscript={props.manuscript}
          characters={props.characters}
          locations={props.locations}
          selectedCharacterId={props.selectedCharacterId}
          selectedLocationId={props.selectedLocationId}
          locateReference={props.locateReference}
          onBack={() => props.mainViewRouter.transition("chat")}
          onSelectContentPane={props.onSelectContentPane}
          onOpenCharacter={props.onOpenCharacter}
          onOpenLocation={props.onOpenLocation}
          onNotify={props.onNotify}
        />
      ) : (
        <ScheduleSurface
          schedule={props.schedule}
          scheduleTodo={props.scheduleTodo}
          approvalStore={props.approvalStore}
          selectedTodoId={props.planTodoId}
          onSelectTodo={props.onSelectPlanTodo}
          onTodoAction={props.onTodoAction}
          onBack={() => props.mainViewRouter.transition("chat")}
        />
      )}
    </main>
  );
});
