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
import type { FrontendPlatform } from "../platform/FrontendPlatform.js";
import { useActiveConversationBinding, useFirstUserMessage } from "../domains/conversation/hooks/useActiveConversationSession.js";
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

/** novel.changed 尾随去抖窗口（ms）：突发连续写实体合并为每实体一次刷新 */
const NOVEL_CHANGE_DEBOUNCE_MS = 150;

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
  /** 平台能力（可选：会话事件 ZMQ 火线等；缺省投影回退 kkrpc 通道） */
  readonly platform?: FrontendPlatform;
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
  platform,
}: ApplicationShellProps) {
  const workspaceAdapter = useMemo(
    () => new WorkspaceControllerAdapter(workspaceController),
    [workspaceController],
  );
  useEffect(() => () => workspaceAdapter.dispose(), [workspaceAdapter]);

  const workspace = useExternalStore(workspaceAdapter);
  const overview = useExternalStore(domainStores.novelOverview);
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

  // 活动会话 binding：shell 只持生命周期（gui-performance-2 功能点五——流式发布
  // 不再重渲染整壳）；快照订阅下沉 ChatSurface，标题派生走首用户消息选择器。
  // 事件源走平台 ZMQ 火线（功能点八；缺省回退 kkrpc）
  const conversationBinding = useActiveConversationBinding(
    api,
    catalogSnapshot.activeConversationId,
    logger,
    platform?.conversationEvents,
  );
  const firstUserMessage = useFirstUserMessage(conversationBinding);
  const approvalSnapshot = useExternalStore(approvalStore);

  // 审批面板数据源 = CMS wait 队列：初始拉取 + 变化通知触发重拉（拉取为准，推送仅触发）
  useEffect(() => {
    void approvalStore.refresh();
    return onApprovalsChanged(() => {
      void approvalStore.refresh();
    });
  }, [approvalStore]);

  // novel 数据变更（agent 经工具写入）→ 按实体类型刷新对应 store（overview 全刷）。
  // 150ms 尾随去抖（gui-performance-2 功能点七）：agent 突发连续写实体时合并为
  // 每实体至多一次 invalidate（+overview 一次），避免 N 次并行全量 refetch 挤占流式渲染。
  useEffect(() => {
    const pendingEntities = new Set<string>();
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    const flush = (): void => {
      flushTimer = undefined;
      const { character, location, storyOutlineTree, manuscriptStructure, novelOverview } =
        domainStores;
      // 实体类型 → 域 store 映射（各 store 均实现统一 invalidate）
      const storeByEntity: Readonly<Record<string, { invalidate(): Promise<void> }>> = {
        character,
        location,
        outline: storyOutlineTree,
        paragraph: manuscriptStructure,
      };
      for (const entity of pendingEntities) {
        const store = storeByEntity[entity];
        if (store !== undefined) void store.invalidate();
      }
      pendingEntities.clear();
      // overview 原语义：任意 novel.changed 都全刷（窗口内合并为一次）
      void novelOverview.invalidate();
    };
    const unsubscribe = onNovelChanged((entity) => {
      pendingEntities.add(entity);
      if (flushTimer !== undefined) return;
      flushTimer = setTimeout(flush, NOVEL_CHANGE_DEBOUNCE_MS);
    });
    return () => {
      unsubscribe();
      if (flushTimer !== undefined) clearTimeout(flushTimer);
    };
  }, [domainStores]);

  // 审批到达自动打开右侧审批面板（面板已会话化，只认活动会话）：
  // 仅当活动会话 pending 集合出现「新 requestId」时 transition
  // （同一请求持续 pending 不重复弹；approval.request 为 persist:false，journal 重放不误弹）。
  const prevPendingIds = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    prevPendingIds.current = new Set();
  }, [catalogSnapshot.activeConversationId]);
  useEffect(() => {
    const ids = new Set(
      approvalSnapshot.approvals
        .filter(
          (approval) =>
            approval.status === "pending" &&
            approval.conversationId === catalogSnapshot.activeConversationId,
        )
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

  // 切换会话（含首次赋值）时：该会话有待审批 → 默认展开审批面板
  // （「每个会话若待审批，默认右侧就是审批面板」）。
  const pendingForActive = approvalSnapshot.approvals.some(
    (approval) =>
      approval.status === "pending" &&
      approval.conversationId === catalogSnapshot.activeConversationId,
  );
  useEffect(() => {
    if (
      catalogSnapshot.activeConversationId !== undefined &&
      pendingForActive
    ) {
      inspectorRouter.transition({
        kind: "approval",
        changeSetId: catalogSnapshot.activeConversationId,
      });
    }
  }, [catalogSnapshot.activeConversationId, pendingForActive, inspectorRouter]);

  // 审批全部处理完 → 自动收起审批面板（creation 线「面板收拢」语义；
  // 与上方的会话化展开共存：全局清零才收起，其他会话仍有待审批时不打断）。
  useEffect(() => {
    const route = inspectorRouter.getSnapshot().state;
    if (approvalSnapshot.pendingCount === 0 && route.kind === "approval") {
      inspectorRouter.close();
    }
  }, [approvalSnapshot.pendingCount, inspectorRouter]);

  // 会话首句派生标题：活动会话首条用户消息到达且目录项仍为自动标题时，
  // 更新侧栏/标题栏显示（显式改名不覆盖；重启恢复由 core scanCatalog 兜底）。
  useEffect(() => {
    if (
      catalogSnapshot.activeConversationId === undefined ||
      firstUserMessage === undefined
    ) {
      return;
    }
    domainStores.conversationCatalog.applyDerivedTitle(
      catalogSnapshot.activeConversationId,
      firstUserMessage.text,
    );
  }, [catalogSnapshot.activeConversationId, firstUserMessage, domainStores]);

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

  // 稳定回调（memo 边界生效前提：shell 重渲染时子组件 props 引用不变）
  const handleToggleSidebar = useCallback(
    () => setSidebarMode((mode) => (mode === "expanded" ? "collapsed" : "expanded")),
    [],
  );
  const handleOpenSchedule = useCallback(
    () => mainViewRouter.transition("schedule"),
    [mainViewRouter],
  );
  const handleShellOpenWorkspace = useCallback(() => onOpenWorkspace?.(), [onOpenWorkspace]);
  const handleShellOpenSettings = useCallback(() => onOpenSettings?.(), [onOpenSettings]);

  return (
    <div className={styles.shell}>
      <TopBar
        workspaceName={workspace.current?.label}
        sidebarMode={sidebarMode}
        onToggleSidebar={handleToggleSidebar}
        onOpenWorkspace={handleShellOpenWorkspace}
        onOpenSettings={handleShellOpenSettings}
        onOpenSchedule={handleOpenSchedule}
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
          conversationBinding={conversationBinding}
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
        />
      </div>
      <OverlaysHost toastStore={toastStore}>{overlays}</OverlaysHost>
    </div>
  );
}
