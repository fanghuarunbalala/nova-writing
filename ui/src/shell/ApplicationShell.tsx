/**
 * ApplicationShell
 *
 * Phase 3 组合根：把 5 个域拼成 topbar/sidebar/main/inspector/overlays，
 * 并承担唯一允许的跨域副作用协调（workspace 切换触发各域 load）。
 * 审批域：活动会话投影 approvals → ApprovalStore；决策经 binding.resolveApproval 回传。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Logger, NovelApiClient } from "@novel/core";
import { useExternalStore } from "../shared/state/useExternalStore.js";
import { useActiveConversationSession } from "../domains/conversation/hooks/useActiveConversationSession.js";
import { createApprovalEntityResolver } from "../domains/approval/approvalEntityResolver.js";
import type { MessageReference } from "../domains/conversation/components/MessageReference.js";
import {
  createDomainReferenceResolver,
  type ReferenceResolver,
} from "../domains/conversation/reference/ReferenceResolver.js";
import { ApprovalStore } from "../domains/approval/ApprovalStore.js";
import { onApprovalsChanged } from "../domains/approval/approvalChangeBus.js";
import { onNovelChanged } from "../domains/novel/novelChangeBus.js";
import type { ToastKind, ToastStore } from "../shared/state/ToastStore.js";
import type { MainViewRouter } from "../shared/routing/MainViewRouter.js";
import type { InspectorRouter } from "../shared/routing/InspectorRouter.js";
import type { ConversationCatalogStore } from "../domains/conversation/store/ConversationCatalogStore.js";
import type { CharacterStore } from "../domains/novel/character/store/CharacterStore.js";
import type { LocationStore } from "../domains/novel/location/store/LocationStore.js";
import type { ManuscriptStructureStore } from "../domains/novel/manuscript/store/ManuscriptStructureStore.js";
import type { NovelOverviewStore } from "../domains/novel/overview/NovelOverviewStore.js";
import type { StoryOutlineTreeStore } from "../domains/novel/outline/store/StoryOutlineTreeStore.js";
import type { ScheduleStore } from "../domains/schedule/store/ScheduleStore.js";
import type { ScheduleTodoStore } from "../domains/schedule/store/ScheduleTodoStore.js";
import type { WorkspaceControllerPort } from "../domains/workspace/store/WorkspaceControllerAdapter.js";
import { WorkspaceControllerAdapter } from "../domains/workspace/store/WorkspaceControllerAdapter.js";
import type { ApplicationConfigurationClient } from "../settings/ApplicationConfigurationClient.js";
import type { ApplicationSettingsStore } from "../settings/ApplicationSettingsStore.js";
import type { ApplicationCommandSource } from "../command/ApplicationCommandSource.js";
import type { NovelUiExtensions } from "../extensions/NovelUiExtensions.js";
import type { ConversationCardRendererRegistry } from "../domains/conversation/cards/ConversationCardRendererRegistry.js";
import type { InspectorRendererRegistry } from "./inspector/InspectorRendererRegistry.js";
import { InspectorHost } from "./inspector/InspectorHost.js";
import { MainArea } from "./main/MainArea.js";
import type { ContentTab } from "./main/contentTab.js";
import { OverlaysHost } from "./overlays/OverlaysHost.js";
import { Sidebar } from "./sidebar/Sidebar.js";
import { TopBar } from "./topbar/TopBar.js";
import styles from "./ApplicationShell.module.css";

export interface ApplicationShellDomainStores {
  readonly conversationCatalog: ConversationCatalogStore;
  readonly novelOverview: NovelOverviewStore;
  readonly storyOutlineTree: StoryOutlineTreeStore;
  readonly manuscriptStructure: ManuscriptStructureStore;
  readonly character: CharacterStore;
  readonly location: LocationStore;
  readonly schedule: ScheduleStore;
  readonly scheduleTodo: ScheduleTodoStore;
}

export interface ApplicationShellProps {
  readonly api: NovelApiClient;
  readonly logger?: Logger;
  readonly mainViewRouter: MainViewRouter;
  readonly inspectorRouter: InspectorRouter;
  readonly workspaceController: WorkspaceControllerPort;
  readonly domainStores: ApplicationShellDomainStores;
  readonly toastStore: ToastStore;
  readonly settingsStore?: ApplicationSettingsStore;
  readonly configurationClient?: ApplicationConfigurationClient;
  readonly commandSource?: ApplicationCommandSource;
  readonly extensions?: NovelUiExtensions;
  readonly inspectorRenderers?: InspectorRendererRegistry;
  readonly conversationCardRenderers?: ConversationCardRendererRegistry;
  readonly onOpenWorkspace?: () => void;
  readonly onOpenSettings?: () => void;
  readonly overlays?: ReactNode;
}

export function ApplicationShell({
  api,
  logger,
  mainViewRouter,
  inspectorRouter,
  workspaceController,
  domainStores,
  toastStore,
  extensions,
  onOpenWorkspace,
  onOpenSettings,
  overlays,
}: ApplicationShellProps) {
  const workspaceAdapter = useMemo(
    () => new WorkspaceControllerAdapter(workspaceController),
    [workspaceController],
  );
  useEffect(() => () => workspaceAdapter.dispose(), [workspaceAdapter]);

  const workspace = useExternalStore(workspaceAdapter);
  const overview = useExternalStore(domainStores.novelOverview);
  const inspector = useExternalStore(inspectorRouter);
  const catalogSnapshot = useExternalStore(domainStores.conversationCatalog);
  const approvalStore = useMemo(() => new ApprovalStore({ api }), [api]);
  // 审批目标实体内容解析器（lite：api.novel.* 查询 + 乐观锁 stale 判定）
  const resolveEntity = useMemo(
    () => createApprovalEntityResolver({ api }),
    [api],
  );
  const [sidebarMode, setSidebarMode] = useState<"expanded" | "collapsed">("expanded");
  const [contentTab, setContentTab] = useState<ContentTab>("outline");
  const [locateReference, setLocateReference] = useState<
    { readonly kind: "chapter" | "paragraph"; readonly id: string; readonly nonce: number } | null
  >(null);
  const workspaceId = workspace.current?.id;

  // 活动会话：shell 级单订阅（ChatSurface 与审批域共用同一投影 binding）
  const session = useActiveConversationSession(api, catalogSnapshot.activeConversationId, logger);
  const approvalSnapshot = useExternalStore(approvalStore);

  // 审批面板数据源 = CMS wait 队列：初始拉取 + 变化通知触发重拉（拉取为准，推送仅触发）
  useEffect(() => {
    void approvalStore.refresh();
    return onApprovalsChanged(() => {
      void approvalStore.refresh();
    });
  }, [approvalStore]);

  // novel 数据变更（agent 经工具写入）→ 按实体类型刷新对应 store（overview 全刷）
  useEffect(() => {
    return onNovelChanged((entity) => {
      const { character, location, storyOutlineTree, manuscriptStructure, novelOverview } =
        domainStores;
      switch (entity) {
        case "character":
          void character.invalidate();
          break;
        case "location":
          void location.invalidate();
          break;
        case "outline":
          void storyOutlineTree.invalidate();
          break;
        case "paragraph":
          void manuscriptStructure.invalidate();
          break;
      }
      void novelOverview.invalidate();
    });
  }, [domainStores]);

  // 审批到达自动打开左侧审批面板：仅当 pending 集合出现「新 requestId」时 transition
  // （同一请求持续 pending 不重复弹；approval.request 为 persist:false，journal 重放不误弹）。
  const prevPendingIds = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    prevPendingIds.current = new Set();
  }, [catalogSnapshot.activeConversationId]);
  useEffect(() => {
    const ids = new Set(
      approvalSnapshot.approvals
        .filter((approval) => approval.status === "pending")
        .map((approval) => approval.requestId),
    );
    const hasNew = [...ids].some((id) => !prevPendingIds.current.has(id));
    prevPendingIds.current = ids;
    if (hasNew) {
      inspectorRouter.transition({
        kind: "approval",
        changeSetId: catalogSnapshot.activeConversationId ?? "",
      });
    }
  }, [approvalSnapshot, inspectorRouter, catalogSnapshot.activeConversationId]);

  // 跨域副作用协调：workspace 变化时并行触发各域 load（spec 1.5.1）
  useEffect(() => {
    if (workspaceId === undefined) return;
    const {
      conversationCatalog,
      novelOverview,
      storyOutlineTree,
      manuscriptStructure,
      character,
      location,
    } = domainStores;
    void conversationCatalog.loadWorkspace(workspaceId);
    void novelOverview.loadWorkspace(workspaceId);
    void storyOutlineTree.loadWorkspace(workspaceId);
    void manuscriptStructure.loadWorkspace(workspaceId);
    void character.loadWorkspace(workspaceId);
    void location.loadWorkspace(workspaceId);
  }, [domainStores, workspaceId]);

  const handleCreateConversation = useCallback(() => {
    void domainStores.conversationCatalog.createConversation();
  }, [domainStores]);

  const handleSelectConversation = useCallback(
    (id: string) => {
      domainStores.conversationCatalog.selectConversation(id);
      mainViewRouter.transition("chat");
    },
    [domainStores, mainViewRouter],
  );

  const handleSelectOutlineUnit = useCallback(
    (unitId: string) => {
      domainStores.storyOutlineTree.selectUnit(unitId);
      inspectorRouter.transition({ kind: "outlineUnit", unitId });
    },
    [domainStores, inspectorRouter],
  );

  const handleSelectCharacter = useCallback(
    (characterId: string) => {
      domainStores.character.selectCharacter(characterId);
      inspectorRouter.transition({ kind: "entity", entityType: "character", entityId: characterId });
    },
    [domainStores, inspectorRouter],
  );

  const handleSelectLocation = useCallback(
    (locationId: string) => {
      domainStores.location.selectLocation(locationId);
      inspectorRouter.transition({ kind: "entity", entityType: "location", entityId: locationId });
    },
    [domainStores, inspectorRouter],
  );

  const handleTodoAction = useCallback(
    (_id: string, action: string) => {
      if (action === "open-character" || action === "open-location") {
        mainViewRouter.transition("content");
      }
    },
    [mainViewRouter],
  );

  const resolveReference: ReferenceResolver = useCallback(
    createDomainReferenceResolver({
      characters: domainStores.character,
      locations: domainStores.location,
      outline: domainStores.storyOutlineTree,
      manuscript: domainStores.manuscriptStructure,
    }),
    [domainStores],
  );

  const handleReferenceClick = useCallback(
    (reference: MessageReference) => {
      const resolved = resolveReference(reference);
      if (resolved !== undefined && !resolved.known) {
        toastStore.push({
          kind: "warn",
          text: `暂未建立「${resolved.label}」的档案`,
        });
      }
      switch (reference.refKind) {
        case "character":
          handleSelectCharacter(reference.id);
          break;
        case "location":
          handleSelectLocation(reference.id);
          break;
        case "outline":
          handleSelectOutlineUnit(reference.id);
          break;
        case "chapter":
        case "paragraph": {
          const kind = reference.refKind;
          setContentTab("manuscript");
          mainViewRouter.transition("content");
          setLocateReference((current) => ({
            kind,
            id: reference.id,
            nonce: (current?.nonce ?? 0) + 1,
          }));
          break;
        }
      }
    },
    [
      handleSelectCharacter,
      handleSelectLocation,
      handleSelectOutlineUnit,
      mainViewRouter,
      resolveReference,
      toastStore,
    ],
  );

  const handleNotify = useCallback(
    (kind: ToastKind, text: string) => {
      toastStore.push({ kind, text });
    },
    [toastStore],
  );

  const handleSelectContentPane = useCallback(
    (pane: ContentTab) => {
      setContentTab(pane);
      mainViewRouter.transition("content");
    },
    [mainViewRouter],
  );

  return (
    <div className={styles.shell}>
      <TopBar
        workspaceName={workspace.current?.label}
        sidebarMode={sidebarMode}
        onToggleSidebar={() =>
          setSidebarMode((mode) => (mode === "expanded" ? "collapsed" : "expanded"))
        }
        onOpenWorkspace={() => onOpenWorkspace?.()}
        onOpenSettings={() => onOpenSettings?.()}
        onOpenSchedule={() => mainViewRouter.transition("schedule")}
        approvalBadge={approvalSnapshot.pendingCount}
        approvalActive={inspector.state.kind === "approval"}
        onOpenApproval={() =>
          inspectorRouter.transition({
            kind: "approval",
            changeSetId: catalogSnapshot.activeConversationId ?? "",
          })
        }
        extensions={extensions}
      />
      <div className={styles.body} data-sidebar-mode={sidebarMode}>
        <Sidebar
          mode={sidebarMode}
          conversationCatalog={domainStores.conversationCatalog}
          novelOverview={domainStores.novelOverview}
          toastStore={toastStore}
          onCreateConversation={handleCreateConversation}
          onSelectConversation={handleSelectConversation}
          contentTab={contentTab}
          onSelectContentPane={handleSelectContentPane}
          workspaceId={workspaceId}
          workspaceLabel={workspace.current?.label}
          revision={overview.sourceRevision}
          onOpenWorkspace={onOpenWorkspace}
        />
        <MainArea
          api={api}
          logger={logger}
          session={session}
          pendingApprovalCount={
            approvalSnapshot.approvals.filter(
              (item) =>
                item.conversationId === catalogSnapshot.activeConversationId &&
                item.status === "pending",
            ).length
          }
          mainViewRouter={mainViewRouter}
          conversationCatalog={domainStores.conversationCatalog}
          outlineTree={domainStores.storyOutlineTree}
          manuscript={domainStores.manuscriptStructure}
          characters={domainStores.character}
          locations={domainStores.location}
          schedule={domainStores.schedule}
          scheduleTodo={domainStores.scheduleTodo}
          contentTab={contentTab}
          onCreateConversation={handleCreateConversation}
          onSelectOutlineUnit={handleSelectOutlineUnit}
          onSelectCharacter={handleSelectCharacter}
          onSelectLocation={handleSelectLocation}
          onTodoAction={handleTodoAction}
          onReferenceClick={handleReferenceClick}
          resolveReference={resolveReference}
          locateReference={locateReference}
          onNotify={handleNotify}
          approvalStore={approvalStore}
        />
        <InspectorHost
          inspectorRouter={inspectorRouter}
          conversationCatalog={domainStores.conversationCatalog}
          outlineTree={domainStores.storyOutlineTree}
          characters={domainStores.character}
          locations={domainStores.location}
          approvalStore={approvalStore}
          resolveEntity={resolveEntity}
          onJumpToConversation={handleSelectConversation}
        />
      </div>
      <OverlaysHost toastStore={toastStore}>{overlays}</OverlaysHost>
    </div>
  );
}
