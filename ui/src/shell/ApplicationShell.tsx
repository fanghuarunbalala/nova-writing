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
import { useMainView, useInspectorRoute } from "../shared/routing/hooks.js";
import type { FrontendPlatform } from "../platform/FrontendPlatform.js";
import { useActiveConversationBinding, useFirstUserMessage } from "../domains/conversation/hooks/useActiveConversationSession.js";
import { createApprovalEntityResolver } from "../domains/approval/approvalEntityResolver.js";
import type { MessageReference } from "../domains/conversation/components/MessageReference.js";
import {
  createDomainReferenceResolver,
  type ReferenceResolver,
} from "../domains/conversation/reference/ReferenceResolver.js";
import { ApprovalStore } from "../domains/approval/ApprovalStore.js";
import { ApprovalModalStore } from "../domains/approval/ApprovalModalStore.js";
import { ApprovalModal } from "../domains/approval/components/ApprovalModal.js";
import { onApprovalsChanged } from "../domains/approval/approvalChangeBus.js";
import { AskingStore } from "../domains/asking/AskingStore.js";
import { onAskingsChanged } from "../domains/asking/askingChangeBus.js";
import { onNovelChanged } from "../domains/novel/novelChangeBus.js";
import type { ToastKind, ToastStore } from "../shared/state/ToastStore.js";
import type { MainViewState, MainViewRouter } from "../shared/routing/MainViewRouter.js";
import type { InspectorRouter } from "../shared/routing/InspectorRouter.js";
import type { ConversationCatalogStore } from "../domains/conversation/store/ConversationCatalogStore.js";
import type { CharacterStore } from "../domains/novel/character/store/CharacterStore.js";
import type { LocationStore } from "../domains/novel/location/store/LocationStore.js";
import type { ManuscriptStructureStore } from "../domains/novel/manuscript/store/ManuscriptStructureStore.js";
import type { NovelOverviewStore } from "../domains/novel/overview/NovelOverviewStore.js";
import type { StoryOutlineTreeStore } from "../domains/novel/outline/store/StoryOutlineTreeStore.js";
import type { ScheduleStore } from "../domains/schedule/store/ScheduleStore.js";
import type { ScheduleTodoStore } from "../domains/schedule/store/ScheduleTodoStore.js";
import type {
  NotificationItem,
  NotificationStore,
} from "../domains/notification/index.js";
import type { WorkspaceControllerPort } from "../domains/workspace/store/WorkspaceControllerAdapter.js";
import { WorkspaceControllerAdapter } from "../domains/workspace/store/WorkspaceControllerAdapter.js";
import type { ApplicationConfigurationClient } from "../settings/ApplicationConfigurationClient.js";
import type { ApplicationSettingsStore } from "../settings/ApplicationSettingsStore.js";
import type { ApplicationCommandSource } from "../command/ApplicationCommandSource.js";
import type { NovelUiExtensions } from "../extensions/NovelUiExtensions.js";
import type { ConversationCardRendererRegistry } from "../domains/conversation/cards/ConversationCardRendererRegistry.js";
import type { InspectorRendererRegistry } from "./inspector/InspectorRendererRegistry.js";
import { InspectorHost } from "./inspector/InspectorHost.js";
import { ContentDirectoryStore } from "./inspector/ContentDirectoryStore.js";
import { MainArea } from "./main/MainArea.js";
import type { ContentTab } from "./main/contentTab.js";
import { OverlaysHost } from "./overlays/OverlaysHost.js";
import { Sidebar } from "./sidebar/Sidebar.js";
import { TopBar } from "./topbar/TopBar.js";
import type { WindowChromeProps } from "./topbar/WindowControls.js";
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
  readonly notifications: NotificationStore;
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
  /** 窗口控制（PRD WC；桌面宿主经 preload 桥注入） */
  readonly windowChrome?: WindowChromeProps;
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
  settingsStore,
  extensions,
  onOpenWorkspace,
  onOpenSettings,
  overlays,
  platform,
  windowChrome,
}: ApplicationShellProps) {
  const workspaceAdapter = useMemo(
    () => new WorkspaceControllerAdapter(workspaceController),
    [workspaceController],
  );
  useEffect(() => () => workspaceAdapter.dispose(), [workspaceAdapter]);

  const workspace = useExternalStore(workspaceAdapter);
  const catalogSnapshot = useExternalStore(domainStores.conversationCatalog);
  const approvalStore = useMemo(() => new ApprovalStore({ api }), [api]);
  // 审批整体弹窗（方案 A）：开关与选中态；挂起时阻塞发送，稍后处理由提示条唤回
  const approvalModalStore = useMemo(() => new ApprovalModalStore(), []);
  const approvalModalSnapshot = useExternalStore(approvalModalStore);
  // 审批目标实体内容解析器（lite：api.novel.* 查询 + 乐观锁 stale 判定）
  const resolveEntity = useMemo(
    () => createApprovalEntityResolver({ api }),
    [api],
  );
  const [sidebarMode, setSidebarMode] = useState<"expanded" | "collapsed">("expanded");
  // 右栏自定义宽度（>1280 生效）：初值取设置快照（宿主接线后持久化），变更写回
  const [inspectorWidthPx, setInspectorWidthPx] = useState<number | undefined>(
    () => settingsStore?.getSnapshot().inspectorWidthPx,
  );
  const handleInspectorWidthChange = useCallback(
    (px: number | undefined) => {
      setInspectorWidthPx(px);
      settingsStore?.setInspectorWidthPx(px);
    },
    [settingsStore],
  );
  const mainView = useMainView(mainViewRouter);
  const inspectorRoute = useInspectorRoute(inspectorRouter);
  // 右栏内容目录（demo 方案 A v0.8）：tab / 手风琴 / 实体标签定位
  const contentDirectory = useMemo(() => new ContentDirectoryStore(), []);
  const [contentTab, setContentTab] = useState<ContentTab>("outline");
  // 档案/计划选区（PRD CV/PN）：人物·地点详情在内容视图主区渲染，
  // 选区状态由壳持有（目录在侧栏、详情在主区，二者为兄弟节点）。
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | undefined>(undefined);
  const [selectedLocationId, setSelectedLocationId] = useState<string | undefined>(undefined);
  const [planTodoId, setPlanTodoId] = useState<string | null>(null);
  const [locateReference, setLocateReference] = useState<
    { readonly kind: "chapter" | "paragraph"; readonly id: string; readonly nonce: number } | null
  >(null);
  const workspaceId = workspace.current?.id;

  // 通知中心数据源（1/2）工作区切换：清空旧项目通知（跨项目不串）+ 记 system 通知；
  // 首次挂载不记（那是「打开」而非「切换」）。
  const prevWorkspaceSession = useRef<{ readonly id: string; readonly label: string } | undefined>(
    undefined,
  );
  useEffect(() => {
    const current = workspace.current;
    const previous = prevWorkspaceSession.current;
    prevWorkspaceSession.current = current;
    if (current === undefined || previous === undefined) return;
    const notifications = domainStores.notifications;
    notifications.clear();
    notifications.upsert({
      id: `ws-switch:${current.id}`,
      type: "system",
      title: "已切换工作区",
      desc: `《${previous.label}》 → 《${current.label}》`,
      createdAt: Date.now(),
      read: false,
    });
  }, [workspace.current, domainStores.notifications]);

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
  const askingStore = useMemo(() => new AskingStore({ api }), [api]);
  const askingSnapshot = useExternalStore(askingStore);

  // 审批面板数据源 = CMS wait 队列：初始拉取 + 变化通知触发重拉（拉取为准，推送仅触发）
  useEffect(() => {
    void approvalStore.refresh();
    return onApprovalsChanged(() => {
      void approvalStore.refresh();
    });
  }, [approvalStore]);

  // 提问卡数据源 = CMS wait 队列 asking 条目：同款拉取为准 + 推送触发
  useEffect(() => {
    void askingStore.refresh();
    return onAskingsChanged(() => {
      void askingStore.refresh();
    });
  }, [askingStore]);

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
      // 事件链终点可观测性：去抖合并后实际刷新的实体批次（main 侧有 mutated/forwarded 前置日志）
      logger?.info("shell.novel_changed_refresh", { entities: [...pendingEntities] });
      // 实体类型 → 域 store 映射（各 store 均实现统一 invalidate）。
      // publication（卷/章及章选择 paragraphIds）变更直接影响正文结构视图——
      // 段落真正进正文靠 publication.chapter.update，漏映射会导致会话内正文不刷新、重启才可见。
      const storeByEntity: Readonly<Record<string, { invalidate(): Promise<void> }>> = {
        character,
        location,
        outline: storyOutlineTree,
        paragraph: manuscriptStructure,
        publication: manuscriptStructure,
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
  }, [domainStores, logger]);

  // 审批到达自动弹窗一次（面板已会话化，只认活动会话）：
  // 仅当活动会话 pending 集合出现「新 requestId」时唤起
  // （同一请求持续 pending 不重复弹；approval.request 为 persist:false，journal 重放不误弹；
  //   稍后处理收起后同一请求不重弹——由 挂起提示条/状态行/工具行 唤回）。
  const prevPendingIds = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    prevPendingIds.current = new Set();
  }, [catalogSnapshot.activeConversationId]);
  useEffect(() => {
    const activeId = catalogSnapshot.activeConversationId;
    const ids = new Set(
      approvalSnapshot.approvals
        .filter(
          (approval) =>
            approval.status === "pending" &&
            approval.conversationId === activeId,
        )
        .map((approval) => approval.requestId),
    );
    const fresh = [...ids].filter((id) => !prevPendingIds.current.has(id));
    prevPendingIds.current = ids;
    if (fresh.length > 0 && activeId !== undefined) {
      approvalModalStore.summon(`${activeId}:${fresh[0]}`);
    }
  }, [approvalSnapshot, approvalModalStore, catalogSnapshot.activeConversationId]);

  // 本会话审批全部处理完 → 弹窗自动收口 + toast（时间线不留过往审批记录）。
  // 与上方唤起共存：其他会话仍有待审批时不收口（弹窗按活动会话过滤）。
  const pendingInActiveConversation = approvalSnapshot.approvals.some(
    (approval) =>
      approval.status === "pending" &&
      approval.conversationId === catalogSnapshot.activeConversationId,
  );
  useEffect(() => {
    if (!pendingInActiveConversation && approvalModalSnapshot.open) {
      approvalModalStore.minimize();
      toastStore.push({ kind: "success", text: "本轮审批已全部处理，会话继续" });
    }
  }, [
    pendingInActiveConversation,
    approvalModalSnapshot.open,
    approvalModalStore,
    toastStore,
  ]);

  // 通知中心数据源（2/2）审批聚合：全局 pending 数（不限活动会话）→ 通知条目；
  // 计数较上次增长才置未读（持续 pending 不重复打扰），归零移除。
  const prevPendingTotal = useRef(0);
  useEffect(() => {
    const pending = approvalSnapshot.approvals.filter((item) => item.status === "pending");
    const notifications = domainStores.notifications;
    if (pending.length === 0) {
      prevPendingTotal.current = 0;
      notifications.remove("approvals");
      return;
    }
    const grew = pending.length > prevPendingTotal.current;
    prevPendingTotal.current = pending.length;
    notifications.upsert({
      id: "approvals",
      type: "approval",
      title: `写入待审批 · ${pending.length} 项`,
      desc: `工具 ${pending[0]?.toolCalls[0]?.toolName ?? "—"} · 待你决策`,
      createdAt: Date.now(),
      read: !grew,
      goto: { view: "chat" },
    });
  }, [approvalSnapshot, domainStores.notifications]);

  // 通知中心数据源（3/3）提问聚合：全局 pending 数（不限活动会话）→ 通知条目；
  // 计数增长才置未读，归零移除（与审批聚合同款节流语义）。
  const prevPendingAskTotal = useRef(0);
  useEffect(() => {
    const pending = askingSnapshot.askings.filter((item) => item.status === "pending");
    const notifications = domainStores.notifications;
    if (pending.length === 0) {
      prevPendingAskTotal.current = 0;
      notifications.remove("askings");
      return;
    }
    const grew = pending.length > prevPendingAskTotal.current;
    prevPendingAskTotal.current = pending.length;
    notifications.upsert({
      id: "askings",
      type: "asking",
      title: `作者待作答 · ${pending.length} 组提问`,
      desc: `「${pending[0]?.questions[0]?.header ?? "—"}」等 ${pending[0]?.questions.length ?? 0} 问 · 在对话流内作答`,
      createdAt: Date.now(),
      read: !grew,
      goto: { view: "chat" },
    });
  }, [askingSnapshot, domainStores.notifications]);

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

  // 进入对话视图默认展开内容目录（首次挂载同样生效）；用户手动收起后
  // 本次停留内不再强制展开（离开再回来才恢复默认）。
  const prevViewStateRef = useRef<MainViewState | undefined>(undefined);
  useEffect(() => {
    const prev = prevViewStateRef.current;
    prevViewStateRef.current = mainView.state;
    if (
      mainView.state === "chat" &&
      prev !== "chat" &&
      inspectorRouter.getSnapshot().state.kind === "closed"
    ) {
      inspectorRouter.transition({ kind: "directory" });
    }
  }, [mainView.state, inspectorRouter]);

  // 对话顶条「内容目录」开关：directory ↔ closed（原地切换，不重渲染对话流）
  const handleToggleDirectory = useCallback(() => {
    if (inspectorRouter.getSnapshot().state.kind === "directory") {
      inspectorRouter.close();
    } else {
      inspectorRouter.transition({ kind: "directory" });
    }
  }, [inspectorRouter]);

  const handleCreateConversation = useCallback(() => {
    void domainStores.conversationCatalog.createConversation();
  }, [domainStores]);

  // 侧栏宽度固定档位（决议 2：移除拖拽调宽），无本域逻辑。

  const handleSelectConversation = useCallback(
    (id: string) => {
      domainStores.conversationCatalog.selectConversation(id);
      mainViewRouter.transition("chat");
    },
    [domainStores, mainViewRouter],
  );

  // 大纲单元：目录树选中即主区详情（PRD OL-1；不再开 inspector）。
  const handleSelectOutlineUnit = useCallback(
    (unitId: string) => {
      domainStores.storyOutlineTree.selectUnit(unitId);
      setContentTab("outline");
      mainViewRouter.transition("content");
    },
    [domainStores, mainViewRouter],
  );

  // 人物/地点：选区入壳 + 内容视图对应资料位（PRD PM/PL）。
  const handleSelectCharacter = useCallback(
    (characterId: string) => {
      setSelectedCharacterId(characterId);
      setContentTab("characters");
      mainViewRouter.transition("content");
    },
    [mainViewRouter],
  );

  const handleSelectLocation = useCallback(
    (locationId: string) => {
      setSelectedLocationId(locationId);
      setContentTab("locations");
      mainViewRouter.transition("content");
    },
    [mainViewRouter],
  );

  const handleSelectChapter = useCallback(
    (chapterId: string) => {
      domainStores.manuscriptStructure.selectChapter(chapterId);
    },
    [domainStores],
  );

  // 待办动作跨视图直达（PRD PN-8）：去审批 → 对话 + 唤起审批弹窗；
  // 去完善档案 → 内容视图对应资料位。
  const handleTodoAction = useCallback(
    (_id: string, action: string) => {
      if (action === "open-approval") {
        mainViewRouter.transition("chat");
        approvalModalStore.summon();
      } else if (action === "open-character") {
        setContentTab("characters");
        mainViewRouter.transition("content");
      } else if (action === "open-location") {
        setContentTab("locations");
        mainViewRouter.transition("content");
      }
    },
    [approvalModalStore, mainViewRouter],
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
        case "location": {
          // 对话视图：实体标签定位优先（demo 方案 A）——右栏目录切 tab +
          // 展开详情卡 + 滚动高亮；详情卡「打开完整档案」再跳内容视图。
          if (mainView.state === "chat") {
            contentDirectory.locate(reference.refKind, reference.id);
            inspectorRouter.transition({ kind: "directory" });
          } else if (reference.refKind === "character") {
            handleSelectCharacter(reference.id);
          } else {
            handleSelectLocation(reference.id);
          }
          break;
        }
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
      mainView,
      mainViewRouter,
      contentDirectory,
      inspectorRouter,
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

  const handleSelectPlanTodo = useCallback((id: string | null) => {
    setPlanTodoId(id);
  }, []);

  // 会话信息面板（PRD 决议 1：并入对话 subHead「更多」，inspector conversation 路由）
  const handleOpenConversationInfo = useCallback(
    (conversationId: string) => {
      inspectorRouter.transition({ kind: "conversation", conversationId });
    },
    [inspectorRouter],
  );

  // 稳定回调（memo 边界生效前提：shell 重渲染时子组件 props 引用不变）
  const handleToggleSidebar = useCallback(
    () => setSidebarMode((mode) => (mode === "expanded" ? "collapsed" : "expanded")),
    [],
  );
  const handleViewChange = useCallback(
    (next: MainViewState) => mainViewRouter.transition(next),
    [mainViewRouter],
  );
  const handleShellOpenWorkspace = useCallback(() => onOpenWorkspace?.(), [onOpenWorkspace]);
  const handleShellOpenSettings = useCallback(() => onOpenSettings?.(), [onOpenSettings]);
  // 通知条目激活：goto.view 切主视图；审批类额外唤起审批弹窗
  const handleNotificationActivate = useCallback(
    (item: NotificationItem) => {
      if (item.goto?.view !== undefined) mainViewRouter.transition(item.goto.view);
      if (item.type === "approval") {
        approvalModalStore.summon();
      }
    },
    [mainViewRouter, approvalModalStore],
  );

  // 唤起审批弹窗（挂起提示条 / 状态行 / 工具行 / 时间线系统行共用）；
  // 携带 requestId 时定位到该审批组（时间线入口用）。
  const handleSummonApproval = useCallback(
    (requestId?: string) => {
      const activeId = catalogSnapshot.activeConversationId;
      approvalModalStore.summon(
        requestId !== undefined && activeId !== undefined
          ? `${activeId}:${requestId}`
          : undefined,
      );
    },
    [approvalModalStore, catalogSnapshot.activeConversationId],
  );

  return (
    <div className={styles.shell}>
      <TopBar
        workspaceName={workspace.current?.label}
        sidebarMode={sidebarMode}
        onToggleSidebar={handleToggleSidebar}
        view={mainView.state}
        onViewChange={handleViewChange}
        onOpenWorkspace={handleShellOpenWorkspace}
        onOpenSettings={handleShellOpenSettings}
        notifications={domainStores.notifications}
        onNotificationActivate={handleNotificationActivate}
        extensions={extensions}
        windowChrome={windowChrome}
      />
      <div className={styles.body}>
        <Sidebar
          mode={sidebarMode}
          view={mainView.state}
          conversationCatalog={domainStores.conversationCatalog}
          outlineTree={domainStores.storyOutlineTree}
          manuscript={domainStores.manuscriptStructure}
          characters={domainStores.character}
          locations={domainStores.location}
          schedule={domainStores.schedule}
          scheduleTodo={domainStores.scheduleTodo}
          approvalStore={approvalStore}
          toastStore={toastStore}
          workspaceId={workspaceId}
          onCreateConversation={handleCreateConversation}
          onSelectConversation={handleSelectConversation}
          contentTab={contentTab}
          onSelectContentPane={handleSelectContentPane}
          onSelectOutlineUnit={handleSelectOutlineUnit}
          onSelectChapter={handleSelectChapter}
          selectedCharacterId={selectedCharacterId}
          selectedLocationId={selectedLocationId}
          onSelectCharacter={handleSelectCharacter}
          onSelectLocation={handleSelectLocation}
          planTodoId={planTodoId}
          onSelectPlanTodo={handleSelectPlanTodo}
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
          approvalModalOpen={approvalModalSnapshot.open}
          onSummonApproval={handleSummonApproval}
          directoryOpen={inspectorRoute.state.kind !== "closed"}
          onToggleDirectory={handleToggleDirectory}
          askings={askingSnapshot.askings.filter(
            (item) => item.conversationId === catalogSnapshot.activeConversationId,
          )}
          pendingAskingCount={
            askingSnapshot.askings.filter(
              (item) =>
                item.conversationId === catalogSnapshot.activeConversationId &&
                item.status === "pending",
            ).length
          }
          onResolveAsking={(requestId, answers) => {
            void askingStore.resolve(requestId, answers);
          }}
          onSkipAsking={(requestId) => {
            const item = askingSnapshot.askings.find((a) => a.requestId === requestId);
            if (item === undefined) return;
            void askingStore.resolve(
              requestId,
              item.questions.map((q) => ({ question: q.question, selections: [], skipped: true })),
            );
          }}
          mainViewRouter={mainViewRouter}
          conversationCatalog={domainStores.conversationCatalog}
          outlineTree={domainStores.storyOutlineTree}
          manuscript={domainStores.manuscriptStructure}
          characters={domainStores.character}
          locations={domainStores.location}
          schedule={domainStores.schedule}
          scheduleTodo={domainStores.scheduleTodo}
          contentTab={contentTab}
          selectedCharacterId={selectedCharacterId}
          selectedLocationId={selectedLocationId}
          planTodoId={planTodoId}
          onSelectPlanTodo={handleSelectPlanTodo}
          onCreateConversation={handleCreateConversation}
          onOpenConversationInfo={handleOpenConversationInfo}
          onTodoAction={handleTodoAction}
          onReferenceClick={handleReferenceClick}
          resolveReference={resolveReference}
          locateReference={locateReference}
          onNotify={handleNotify}
          onSelectContentPane={handleSelectContentPane}
          onOpenCharacter={handleSelectCharacter}
          onOpenLocation={handleSelectLocation}
          approvalStore={approvalStore}
        />
        <InspectorHost
          inspectorRouter={inspectorRouter}
          visible={mainView.state === "chat"}
          conversationCatalog={domainStores.conversationCatalog}
          contentDirectory={contentDirectory}
          outlineTree={domainStores.storyOutlineTree}
          characters={domainStores.character}
          locations={domainStores.location}
          onSelectOutlineUnit={handleSelectOutlineUnit}
          onOpenCharacter={handleSelectCharacter}
          onOpenLocation={handleSelectLocation}
          widthPx={inspectorWidthPx}
          onWidthChange={handleInspectorWidthChange}
        />
      </div>
      <OverlaysHost toastStore={toastStore}>
        {overlays}
        <ApprovalModal
          store={approvalStore}
          modalStore={approvalModalStore}
          conversationId={catalogSnapshot.activeConversationId}
          resolveEntity={resolveEntity}
          onNotify={handleNotify}
        />
      </OverlaysHost>
    </div>
  );
}
