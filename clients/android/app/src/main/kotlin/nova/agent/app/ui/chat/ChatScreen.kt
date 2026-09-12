package nova.agent.app.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
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
fun ChatScreen(vm: ChatViewModel) {
    val state by vm.uiState.collectAsStateWithLifecycle()

    ChatBody(
        state = state,
        onInputChange = vm::inputChange,
        onSend = vm::send,
        onStop = vm::stop,
        onRetry = vm::retry,
        onModeChange = vm::execModeChange,
        onToggleReasoning = vm::toggleReasoning,
        onLoadOlder = vm::loadOlder,
        onResumeLease = vm::resumeLease,
    )

    // ---- 审批 sheet（pendingApproval 非 null 即弹层） ----
    state.pendingApproval?.let { approval ->
        nova.agent.app.ui.approval.ApprovalSheet(
            approval = approval,
            onCardDecided = { requestId, cardId, approved, _ -> vm.decideCard(requestId, cardId, approved) },
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
                ChatOneShot.ApprovalExpired -> Unit
            }
        }
    }
    val palette = LocalNovaPalette.current
    conflictHolder?.let { holder ->
        AlertDialog(
            onDismissRequest = { conflictHolder = null },
            containerColor = palette.surface,
            title = { Text("会话被其他设备持有", style = NovaTypography.titleSmall) },
            text = { Text("「$holder」持有写作租约。可等待其释放，或从该设备退出会话后再接续。", style = NovaTypography.bodyMedium) },
            confirmButton = {
                TextButton(onClick = { conflictHolder = null }) { Text("知道了", color = palette.accent) }
            },
        )
    }
    if (disconnected) {
        AlertDialog(
            onDismissRequest = { disconnected = false },
            containerColor = palette.surface,
            title = { Text("连接已断开", style = NovaTypography.titleSmall) },
            text = { Text("SSE 通道断线（demo 旁路）。重连后将从游标续拉，期间输入进入本地积压。", style = NovaTypography.bodyMedium) },
            confirmButton = {
                TextButton(onClick = { disconnected = false }) { Text("重连", color = palette.accent) }
            },
            dismissButton = {
                TextButton(onClick = { disconnected = false }) { Text("稍后", color = palette.muted) }
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
            ReadOnlyBanner(lease, onResume = onResumeLease)
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
            if (state.hasMoreOlder) {
                item(key = "load-older") {
                    LoadOlderRow(loading = loadingOlder) { onLoadOlder() }
                }
            }
            items(state.items, key = { it.id }) { item ->
                ChatItemView(item, onToggleReasoning)
            }
            if (state.draft.isNotEmpty()) {
                item(key = "draft-panel") {
                    TypewriterDraftPanel(state.draft)
                }
            }
        }

        InputBar(
            input = state.input,
            execMode = state.execMode,
            busy = state.isBusy,
            onInputChange = onInputChange,
            onSend = onSend,
            onStop = onStop,
            onModeChange = onModeChange,
        )
    }
}

@Composable
private fun ChatItemView(item: ChatItem, onToggleReasoning: (String) -> Unit) {
    when (item) {
        is ChatItem.UserMsg -> UserBubble(item)
        is ChatItem.AssistantMsg -> AssistantBlock(item, onToggleReasoning = { onToggleReasoning(item.id) })
        is ChatItem.ToolLine -> ToolRow(item)
        is ChatItem.GhostItem -> GhostQueueRow(item)
        is ChatItem.SysPill -> SysPillView(item)
        is ChatItem.AskCard -> AskCardView(item)
    }
}
