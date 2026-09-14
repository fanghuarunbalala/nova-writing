package nova.agent.app.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.flow.distinctUntilChanged
import nova.agent.app.data.ChatItem
import nova.agent.app.data.ChatOneShot
import nova.agent.app.data.ChatUiState
import nova.agent.app.data.ExecMode
import nova.agent.app.ui.theme.LocalNovaPalette
import nova.agent.app.ui.theme.NovaTypography
import nova.agent.app.ui.vm.ChatViewModel

/**
 * 聊天基座（PRD FR7 视图树）——VM 装配壳：
 * 状态驱动渲染在 [ChatBody]（可直接组合截图）；一次性事件与审批弹层在这里接线。
 */
@Composable
fun ChatScreen(vm: ChatViewModel, onOpenEntity: (tab: Int) -> Unit = {}, onWaitRecover: () -> Unit = {}) {
    val state by vm.uiState.collectAsStateWithLifecycle()

    // VM 侧操作反馈（如「已加载更早 1 段」）→ 全局 snackbar（2.6s）
    val feedback = nova.agent.app.ui.common.rememberFeedback()
    LaunchedEffect(vm) {
        vm.feedback.collect { feedback(it) }
    }

    ChatBody(
        state = state,
        onInputChange = vm::inputChange,
        onSend = vm::send,
        onStop = {
            vm.stop()
            feedback("已暂停——当前轮作废，journal 记录 ABORTED")
        },
        onRetry = vm::retry,
        onModeChange = vm::execModeChange,
        onToggleReasoning = vm::toggleReasoning,
        onLoadOlder = vm::loadOlder,
        onResumeLease = vm::resumeLease,
        onFollowLease = vm::followLease,
        onRefreshLease = vm::refreshLease,
        onOpenEntity = onOpenEntity,
    )

    // ---- 审批 sheet（pendingApproval 非 null 即弹层） ----
    state.pendingApproval?.let { approval ->
        nova.agent.app.ui.approval.ApprovalSheet(
            approval = approval,
            onCardDecided = { requestId, cardId, approved, comment -> vm.decideCard(requestId, cardId, approved, comment) },
            onBatchDecided = { requestId, approved -> vm.decideApproval(requestId, approved) },
            onTimeout = { requestId -> vm.approvalTimeout(requestId) },
            onDismiss = { /* 审批等待期不可划走关闭；裁决/超时自动收 */ },
        )
    }

    // ---- 一次性覆盖层（409 / 断线） ----
    var conflictHolder by remember { mutableStateOf<String?>(null) }
    var disconnected by remember { mutableStateOf(false) }
    LaunchedEffect(vm) {
        vm.oneShot.collect { shot ->
            when (shot) {
                is ChatOneShot.Conflict409 -> conflictHolder = shot.holderDevice
                ChatOneShot.Disconnected -> disconnected = true
                is ChatOneShot.LeaseTakeover -> Unit // 阶段3：顶到后台提示
                ChatOneShot.ApprovalExpired -> Unit // 超时留痕走 reducer（ApprovalTimedOut）
            }
        }
    }
    val palette = LocalNovaPalette.current
    conflictHolder?.let { _ ->
        // demo conflictDlg（L1825-1837 逐字）：两选裁决 + M4 边界注
        AlertDialog(
            onDismissRequest = { conflictHolder = null },
            containerColor = palette.surface,
            title = { Text("补推冲突 · 需人工裁决", style = NovaTypography.titleSmall) },
            text = {
                Text(
                    "恢复连接后补推积压时命中 409：桌面端在离线期间写过 沈砚 · 角色档案（v3），与你本地的积压改动同源。租约需重新申请。\n\n" +
                        "M4 只提示不合并——完整的冲突合并 UI 属 M6（跨端续跑向导）。",
                    style = NovaTypography.bodyMedium,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    conflictHolder = null
                    feedback("已保留服务器版本——本地积压的 2 条变更已丢弃，租约重新申请成功")
                }) { Text("保留服务器版本（丢弃本地积压）", color = palette.accent) }
            },
            dismissButton = {
                TextButton(onClick = {
                    conflictHolder = null
                    feedback("已保留本地版本——覆盖服务器（expectedLastSeq 校验通过），桌面端将收到 409 转只读")
                }) { Text("保留本地版本（覆盖服务器）", color = palette.muted) }
            },
        )
    }
    if (disconnected) {
        // demo offlineDlg（L1809-1821 逐字）：排队发送 / 等待恢复
        AlertDialog(
            onDismissRequest = { disconnected = false },
            containerColor = palette.surface,
            title = { Text("服务器不可达", style = NovaTypography.titleSmall) },
            text = {
                Text(
                    "重连 4 次未成功（退避 1/2/5/10s 封顶）→ 降级离线。本地性能缓存（journal 镜像 + 域快照）仍可完整查看已同步内容；" +
                        "新指令进待发队列（上限 10k 行），恢复后按序补推。\n\n纯云端架构：没有「本地项目」可切——离线只读缓存 + 排队。",
                    style = NovaTypography.bodyMedium,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    disconnected = false
                    vm.setOfflineQueued(true)
                }) { Text("排队发送（恢复后补推）", color = palette.accent) }
            },
            dismissButton = {
                TextButton(onClick = {
                    disconnected = false
                    feedback("等待恢复——只读查看（SSE 断线，进度停在 seq 213）")
                    onWaitRecover()
                }) { Text("等待恢复（只读缓存）", color = palette.muted) }
            },
        )
    }
}

/**
 * 状态驱动的聊天主体（ReadOnlyBanner → RunStatusBanner → LazyColumn → InputBar）。
 *
 * 滚动策略（无 reverseLayout，正向列表）：
 * - 前插锚定：loadOlder 前插后旧首项视觉不动（前插前持续记录 firstVisibleItemIndex/Offset）
 * - 粘底跟随：末项可见时新内容到达自动滚到底；用户上滑即停
 * - 触顶自动 loadOlder
 */
@Composable
fun ChatBody(
    state: ChatUiState,
    onInputChange: (String) -> Unit = {},
    onSend: () -> Unit = {},
    onStop: () -> Unit = {},
    onRetry: () -> Unit = {},
    onModeChange: (ExecMode) -> Unit = {},
    onToggleReasoning: (String) -> Unit = {},
    onLoadOlder: () -> Unit = {},
    onResumeLease: () -> Unit = {},
    onFollowLease: () -> Unit = {},
    onRefreshLease: () -> Unit = {},
    onOpenEntity: (tab: Int) -> Unit = {},
) {
    val palette = LocalNovaPalette.current
    val listState = rememberLazyListState()
    var loadingOlder by remember { mutableStateOf(false) }

    // ---- 前插锚定：持续记录（首项 key, 首项 offset），items 头部变化时恢复 ----
    var anchorKey by remember { mutableStateOf<Any?>(null) }
    var anchorOffset by remember { mutableStateOf(0) }
    LaunchedEffect(listState) {
        snapshotFlow {
            val first = listState.layoutInfo.visibleItemsInfo.firstOrNull()
            if (first != null) first.key to first.offset else null
        }.collect { pair ->
            if (pair != null) {
                anchorKey = pair.first
                anchorOffset = pair.second
            }
        }
    }
    LaunchedEffect(state.items) {
        val headId = state.items.firstOrNull()?.id ?: return@LaunchedEffect
        val oldKey = anchorKey
        if (oldKey is String && oldKey != headId && oldKey.startsWith("h-")) {
            // 发生了历史前插：旧首项新 index（+1 = 顶部 LoadOlderRow）
            val newIdx = state.items.indexOfFirst { it.id == oldKey }
            if (newIdx > 0) listState.scrollToItem(newIdx + 1, anchorOffset)
        }
    }

    // ---- 粘底跟随 + 触顶翻页 ----
    val atBottom by remember {
        derivedStateOf {
            val info = listState.layoutInfo
            val last = info.visibleItemsInfo.lastOrNull() ?: return@derivedStateOf true
            last.index >= info.totalItemsCount - 1
        }
    }
    var autoFollow by remember { mutableStateOf(true) }
    LaunchedEffect(listState) {
        snapshotFlow { atBottom }.distinctUntilChanged().collect { atEnd -> autoFollow = atEnd }
    }
    LaunchedEffect(state.items.size, state.draft) {
        if (autoFollow) {
            val lastIndex = listState.layoutInfo.totalItemsCount - 1
            if (lastIndex >= 0) listState.scrollToItem(lastIndex)
        }
    }
    LaunchedEffect(listState, state.hasMoreOlder) {
        snapshotFlow { listState.firstVisibleItemIndex to state.hasMoreOlder }
            .distinctUntilChanged()
            .collect { (firstIdx, hasMore) ->
                if (firstIdx <= 1 && hasMore && !loadingOlder) {
                    loadingOlder = true
                    onLoadOlder()
                    loadingOlder = false
                }
            }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(palette.bg),
    ) {
        state.lease?.let { lease ->
            ReadOnlyBanner(lease, onResume = onResumeLease, onFollow = onFollowLease)
        }
        RunStatusBanner(
            status = state.runStatus,
            runStartedAt = state.runStartedAt,
            draftCount = state.draftCount,
            onRetry = onRetry,
            runError = state.runError,
        )

        LazyColumn(
            state = listState,
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            contentPadding = PaddingValues(horizontal = 14.dp, vertical = 6.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (state.hasMoreOlder || state.olderRunsRemaining == 0) {
                item(key = "load-older") {
                    LoadOlderRow(
                        loading = loadingOlder,
                        hasMore = state.hasMoreOlder,
                        remaining = state.olderRunsRemaining,
                        onClick = { onLoadOlder() },
                    )
                }
            }
            items(state.items, key = { it.id }) { item ->
                ChatItemView(item, onToggleReasoning, onOpenEntity)
            }
            if (state.draft.isNotEmpty()) {
                item(key = "draft-panel") {
                    TypewriterDraftPanel(state.draft)
                }
            }
        }

        // 断线排队态：积压计数行（demo offlineDlg 队列语义）
        if (state.offlineQueued) {
            val ghosts = state.items.count { it is ChatItem.GhostItem }
            Text(
                "本地积压 $ghosts 条 · 上限 10,000 行 · 恢复后按序补推",
                style = nova.agent.app.ui.theme.NovaText.mono11.copy(color = palette.warn),
                modifier = Modifier
                    .fillMaxWidth()
                    .background(palette.warnBg)
                    .padding(horizontal = 14.dp, vertical = 4.dp),
            )
        }

        // 只读态：roFooter 替换输入区（demo 2376-2380：composer 隐藏）
        val lease = state.lease
        if (lease != null) {
            ReadOnlyFooter(lease, onResume = onResumeLease, onRefresh = onRefreshLease)
        } else {
            InputBar(
                input = state.input,
                execMode = state.execMode,
                pendingMode = state.pendingExecMode,
                busy = state.isBusy,
                onInputChange = onInputChange,
                onSend = onSend,
                onStop = onStop,
                onModeChange = onModeChange,
            )
        }
    }
}

@Composable
private fun ChatItemView(item: ChatItem, onToggleReasoning: (String) -> Unit, onOpenEntity: (tab: Int) -> Unit) {
    when (item) {
        is ChatItem.RoundLabel -> RoundLabelView(item)
        is ChatItem.UserMsg -> UserBubble(item)
        is ChatItem.AssistantMsg -> AssistantBlock(item, onToggleReasoning = { onToggleReasoning(item.id) }, onOpenEntity = onOpenEntity)
        is ChatItem.ToolLine -> ToolRow(item)
        is ChatItem.GhostItem -> GhostQueueRow(item)
        is ChatItem.SysPill -> SysPillView(item)
        is ChatItem.SysLine -> SysLineView(item)
        is ChatItem.AskCard -> AskCardView(item)
    }
}
