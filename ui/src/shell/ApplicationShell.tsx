/**
 * ApplicationShell
 *
 * Phase 3 组合根：把 5 个域拼成 topbar/sidebar/main/inspector/overlays，
 * 并承担唯一允许的跨域副作用协调（workspace 切换触发各域 load）。
 *
 * 契约见 spec 4.1。宿主注入 workspaceController（Port 接口），shell 内部用
 * WorkspaceControllerAdapter 包成 ExternalStore 订阅快照。extensions 走默认
 * emptyNovelUiExtensions，桌面端由 Phase B 注入 createDesktopUiExtensions。
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Logger, NovelApiClient } from "@novel/core";
import { useExternalStore } from "../shared/state/useExternalStore.js";
import type { MessageReference } from "../domains/conversation/components/MessageReference.js";
import {
  createDomainReferenceResolver,
  type ReferenceResolver,
} from "../domains/conversation/reference/ReferenceResolver.js";
import type { ToastStore } from "../shared/state/ToastStore.js";
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
import type { ConversationCardProjectorRegistry } from "../domains/conversation/cards/projection/ConversationCardProjectorRegistry.js";
import type { InspectorRendererRegistry } from "./inspector/InspectorRendererRegistry.js";
import { ApprovalStore } from "../domains/approval/ApprovalStore.js";
import { InspectorHost } from "./inspector/InspectorHost.js";
import { MainArea } from "./main/MainArea.js";
import type { ContentTab } from "./main/contentTab.js";
import { OverlaysHost } from "./overlays/OverlaysHost.js";
import { Sidebar } from "./sidebar/Sidebar.js";
import { TopBar } from "./topbar/TopBar.js";
import styles from "./ApplicationShell.module.css";

/**
 * 域 store 集合。approval 域三个 store 与 workspaceMetadata 在 Phase 2 轨道 C 延后
 * （见 spec 3.3 状态说明与 11 后续工作）；当前接口不含这些字段，Phase 2 轨道 C
 * 落地后追加为可选，再后续转必填。
 */
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
  /**
   * Workspace 控制器（宿主注入）。ApplicationShell 内部用 WorkspaceControllerAdapter
   * 包成 ExternalStore 订阅快照；不要求调用方预先包装。
   */
  readonly workspaceController: WorkspaceControllerPort;
  readonly domainStores: ApplicationShellDomainStores;
  readonly toastStore: ToastStore;
  readonly settingsStore?: ApplicationSettingsStore;
  readonly configurationClient?: ApplicationConfigurationClient;
  readonly commandSource?: ApplicationCommandSource;
  /** 第一方扩展点；不传时用 emptyNovelUiExtensions（spec 4.0.1） */
  readonly extensions?: NovelUiExtensions;
  /** Inspector panel 注册表（Phase 3 引入；当前 InspectorHost 用硬编码 switch） */
  readonly inspectorRenderers?: InspectorRendererRegistry;
  readonly conversationCardRenderers?: ConversationCardRendererRegistry;
  readonly conversationCardProjectors?: ConversationCardProjectorRegistry;
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
  // 内部把 controller port 包成 ExternalStore；卸载时解除订阅（spec 4.1）
  const workspaceAdapter = useMemo(
    () => new WorkspaceControllerAdapter(workspaceController),
    [workspaceController],
  );
  useEffect(() => () => workspaceAdapter.dispose(), [workspaceAdapter]);

  const workspace = useExternalStore(workspaceAdapter);
  const overview = useExternalStore(domainStores.novelOverview);
  const approvalStore = useMemo(() => new ApprovalStore(), []);
  const approvalSnapshot = useExternalStore(approvalStore);
  const [sidebarMode, setSidebarMode] = useState<"expanded" | "collapsed">("expanded");
  const [contentTab, setContentTab] = useState<ContentTab>("outline");
  const [locateReference, setLocateReference] = useState<
    { readonly kind: "chapter" | "paragraph"; readonly id: string; readonly nonce: number } | null
  >(null);
  const workspaceId = workspace.current?.id;
  // extensions 当前由 NovelApp 在 NovelAppProvider 内提供；shell 内 TopBar/Sidebar
  // 的扩展 slot（TopBarMenuSlot / sidebarPanels）在 Phase B 落地后从此处取用。

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

  // 选择对话时同步切换主视图到 chat，确保 ChatSurface 渲染对应会话
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
      if (action === "open-character") {
        mainViewRouter.transition("content");
      } else if (action === "open-location") {
        mainViewRouter.transition("content");
      }
    },
    [mainViewRouter],
  );

  // 引用解析器：从各域 store 当前快照读取档案名与是否已建档。
  const resolveReference: ReferenceResolver = useCallback(
    createDomainReferenceResolver({
      characters: domainStores.character,
      locations: domainStores.location,
      outline: domainStores.storyOutlineTree,
      manuscript: domainStores.manuscriptStructure,
    }),
    [domainStores],
  );

  // 消息内引用点击：角色/地点/大纲 → inspector 档案；章节/段落 → 正文 pane 定位；
  // 未建档 → toast 提示。
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

  // proposal 卡操作：查看 Diff → 右侧审批占位面板；批准/修改待 Step 4 审批域接入。
  const handleProposalAction = useCallback(
    (changeSetId: string, action: "approve" | "reject" | "view-diff") => {
      if (action === "view-diff") {
        inspectorRouter.transition({ kind: "approval", changeSetId });
        return;
      }
      void approvalStore.decide(
        changeSetId,
        action === "approve" ? "approved" : "rejected",
      );
    },
    [approvalStore, inspectorRouter],
  );

  // 时间线"等待审批"行 → 打开审批面板并选中对应请求。
  const handleOpenApproval = useCallback(
    (approvalRequestId: string) => {
      approvalStore.select(approvalRequestId);
      inspectorRouter.transition({ kind: "approval", changeSetId: approvalRequestId });
    },
    [approvalStore, inspectorRouter],
  );

  // 写操作落库后刷新 novel 数据 store（大纲/人物/地点/正文/概览），
  // 让 GUI 内容视图立即反映批准后的正式稿变更。
  // Reload novel data stores after an approved write so content views refresh.
  const refreshNovelData = useCallback(() => {
    if (workspaceId === undefined) return;
    const {
      novelOverview,
      storyOutlineTree,
      manuscriptStructure,
      character,
      location,
    } = domainStores;
    void novelOverview.loadWorkspace(workspaceId);
    void storyOutlineTree.loadWorkspace(workspaceId);
    void manuscriptStructure.loadWorkspace(workspaceId);
    void character.loadWorkspace(workspaceId);
    void location.loadWorkspace(workspaceId);
  }, [domainStores, workspaceId]);

  // 同一轮多个审批连续批准时合并刷新（防抖）。
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const handleNovelDataChanged = useCallback(() => {
    if (refreshTimerRef.current !== undefined) {
      clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = undefined;
      refreshNovelData();
    }, 400);
  }, [refreshNovelData]);
  useEffect(
    () => () => {
      if (refreshTimerRef.current !== undefined) {
        clearTimeout(refreshTimerRef.current);
      }
    },
    [],
  );

  // 护栏：出现新的待审请求时自动打开审批面板（避免"有审批但看不到"）。
  // Auto-open the approval panel when a new pending request appears.
  const lastPendingCountRef = useRef(0);
  useEffect(() => {
    const previous = lastPendingCountRef.current;
    lastPendingCountRef.current = approvalSnapshot.pendingCount;
    const route = inspectorRouter.getSnapshot().state;
    // 审批全部处理完 → 自动收起面板，避免空占位。
    if (
      approvalSnapshot.pendingCount === 0 &&
      route.kind === "approval"
    ) {
      inspectorRouter.close();
      return;
    }
    if (
      approvalSnapshot.pendingCount > 0 &&
      previous === 0 &&
      route.kind === "closed"
    ) {
      inspectorRouter.transition({ kind: "approval", changeSetId: "" });
    }
  }, [approvalSnapshot.pendingCount, inspectorRouter]);

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
        revision={overview.sourceRevision}
        approvalBadge={approvalSnapshot.pendingCount}
        sidebarMode={sidebarMode}
        onToggleSidebar={() =>
          setSidebarMode((mode) => (mode === "expanded" ? "collapsed" : "expanded"))
        }
        onOpenWorkspace={() => onOpenWorkspace?.()}
        onOpenSettings={() => onOpenSettings?.()}
        onOpenSchedule={() => mainViewRouter.transition("schedule")}
        onOpenApproval={() =>
          inspectorRouter.transition({ kind: "approval", changeSetId: "" })
        }
        extensions={extensions}
      />
      <div className={styles.body} data-sidebar-mode={sidebarMode}>
        <Sidebar
          mode={sidebarMode}
          conversationCatalog={domainStores.conversationCatalog}
          novelOverview={domainStores.novelOverview}
          onCreateConversation={handleCreateConversation}
          onSelectConversation={handleSelectConversation}
          schedule={domainStores.schedule}
          scheduleTodo={domainStores.scheduleTodo}
          contentTab={contentTab}
          onSelectContentPane={handleSelectContentPane}
          workspaceId={workspaceId}
          workspaceLabel={workspace.current?.label}
          revision={overview.sourceRevision}
          pendingApprovalCount={approvalSnapshot.pendingCount}
          onOpenWorkspace={onOpenWorkspace}
          onTodoAction={handleTodoAction}
        />
        <MainArea
          api={api}
          logger={logger}
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
          onProposalAction={handleProposalAction}
          onOpenApproval={handleOpenApproval}
          onNovelDataChanged={handleNovelDataChanged}
          approvalStore={approvalStore}
        />
        <InspectorHost
          inspectorRouter={inspectorRouter}
          conversationCatalog={domainStores.conversationCatalog}
          outlineTree={domainStores.storyOutlineTree}
          characters={domainStores.character}
          locations={domainStores.location}
          approvalStore={approvalStore}
        />
      </div>
      <OverlaysHost toastStore={toastStore}>{overlays}</OverlaysHost>
    </div>
  );
}
